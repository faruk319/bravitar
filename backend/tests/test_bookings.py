"""Booking a place in a class.

Sits between the two things that already existed: an Enrolment says somebody
is in a batch, an AttendanceRecord says who turned up. Neither holds a place
for a particular day, which is what capacity and class credits are counted
against.
"""

from datetime import date, timedelta
from decimal import Decimal

from django.utils import timezone

from batches.models import Batch, BookingStatus, ClassBooking
from students.models import Student
from subscriptions.constants import BillingPeriod
from subscriptions.models import MembershipTier

from .base import TenantAPITestCase


class BookingTestCase(TenantAPITestCase):
    def setUp(self):
        super().setUp()
        self.org.verticals = ["gym", "fitness"]
        self.org.save()
        self.today = timezone.localdate()
        # Tomorrow, and a batch that runs every day, so no test is at the
        # mercy of which weekday it happens to run on.
        self.day = self.today + timedelta(days=1)
        self.batch = Batch.objects.create(
            academy=self.org, name="Morning HIIT",
            days_of_week=list(range(7)), capacity=2, is_active=True,
        )
        self.tier = MembershipTier.objects.create(
            academy=self.org, name="Monthly", period=BillingPeriod.MONTHLY,
            duration_days=30, price=Decimal("1500.00"),
        )

    def paid_member(self, name, credits=None):
        """A member with a paid-up plan, so the door lets them in."""
        student = Student.objects.create(
            academy=self.org, full_name=name, joined_on=date(2026, 1, 1)
        )
        tier = self.tier
        if credits is not None:
            tier = MembershipTier.objects.create(
                academy=self.org, name=f"{name} plan", period=BillingPeriod.MONTHLY,
                duration_days=30, price=Decimal("1500.00"),
                class_credits_per_week=credits,
            )
        created = self.client_for(self.manager).post(
            "/api/gym-ops/subscriptions/",
            {"student": student.id, "tier": tier.id, "started_on": str(self.today)},
            format="json",
        )
        invoice = self.client_for(self.manager).get(
            f"/api/gym-ops/subscriptions/{created.data['id']}/"
        ).data["invoice"]
        self.client_for(self.manager).post(
            "/api/billing/payments/",
            {"invoice": invoice, "amount": "1500.00", "paid_on": str(self.today)},
            format="json",
        )
        return student

    def book(self, student, day=None, batch=None):
        return self.client_for(self.manager).post(
            "/api/batches/bookings/",
            {
                "student": student.id,
                "batch": (batch or self.batch).id,
                "session_date": str(day or self.day),
            },
            format="json",
        )


class BookingAPlaceTests(BookingTestCase):
    def test_a_member_can_book_a_session(self):
        response = self.book(self.paid_member("Aarav"))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["status"], "booked")

    def test_the_same_place_cannot_be_booked_twice(self):
        student = self.paid_member("Aarav")
        self.book(student)
        self.assertEqual(self.book(student).status_code, 400)

    def test_a_day_the_batch_does_not_run_is_refused(self):
        self.batch.days_of_week = [(self.day.weekday() + 1) % 7]
        self.batch.save()
        response = self.book(self.paid_member("Aarav"))
        self.assertEqual(response.status_code, 400)
        self.assertIn("doesn't run", str(response.data))

    def test_a_batch_with_no_days_set_cannot_be_booked(self):
        """No days set means nobody has said when it runs — not every day."""
        self.batch.days_of_week = []
        self.batch.save()
        response = self.book(self.paid_member("Aarav"))
        self.assertEqual(response.status_code, 400)
        self.assertIn("which days", str(response.data))

    def test_a_past_day_is_refused(self):
        response = self.book(self.paid_member("Aarav"), day=self.today - timedelta(days=1))
        self.assertEqual(response.status_code, 400)

    def test_a_member_the_door_would_turn_away_cannot_book(self):
        """No point holding a place for somebody who can't get in."""
        unpaid = Student.objects.create(
            academy=self.org, full_name="Owes Money", joined_on=date(2026, 1, 1)
        )
        self.client_for(self.manager).post(
            "/api/gym-ops/subscriptions/",
            {"student": unpaid.id, "tier": self.tier.id, "started_on": str(self.today)},
            format="json",
        )
        response = self.book(unpaid)
        self.assertEqual(response.status_code, 400)
        self.assertIn("payment", str(response.data).lower())

    def test_cancelling_gives_the_place_back(self):
        student = self.paid_member("Aarav")
        created = self.book(student)
        response = self.client_for(self.manager).post(
            f"/api/batches/bookings/{created.data['id']}/cancel/"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "cancelled")
        self.assertEqual(ClassBooking.places_taken(self.batch, self.day), 0)

    def test_a_cancelled_place_can_be_booked_again(self):
        student = self.paid_member("Aarav")
        created = self.book(student)
        self.client_for(self.manager).post(
            f"/api/batches/bookings/{created.data['id']}/cancel/"
        )
        self.assertEqual(self.book(student).status_code, 201)


class CapacityAndWaitlistTests(BookingTestCase):
    def fill_the_session(self):
        for name in ("First", "Second"):
            self.assertEqual(self.book(self.paid_member(name)).status_code, 201)

    def test_a_full_session_puts_you_on_the_waitlist(self):
        """A full class isn't an error — waiting is a real answer."""
        self.fill_the_session()
        response = self.book(self.paid_member("Third"))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["status"], "waitlisted")

    def test_a_cancellation_hands_the_place_to_whoever_is_waiting(self):
        self.fill_the_session()
        waiting = self.book(self.paid_member("Third")).data

        first = ClassBooking.objects.filter(
            batch=self.batch, session_date=self.day, status=BookingStatus.BOOKED
        ).first()
        response = self.client_for(self.manager).post(
            f"/api/batches/bookings/{first.id}/cancel/"
        )

        self.assertEqual(response.data["promoted"]["id"], waiting["id"])
        self.assertEqual(
            ClassBooking.objects.get(pk=waiting["id"]).status, BookingStatus.BOOKED
        )

    def test_the_queue_is_first_come_first_served(self):
        self.fill_the_session()
        third = self.book(self.paid_member("Third")).data
        self.book(self.paid_member("Fourth"))

        first = ClassBooking.objects.filter(
            batch=self.batch, session_date=self.day, status=BookingStatus.BOOKED
        ).first()
        response = self.client_for(self.manager).post(
            f"/api/batches/bookings/{first.id}/cancel/"
        )
        self.assertEqual(response.data["promoted"]["id"], third["id"])

    def test_cancelling_from_the_waitlist_promotes_nobody(self):
        self.fill_the_session()
        waiting = self.book(self.paid_member("Third")).data
        response = self.client_for(self.manager).post(
            f"/api/batches/bookings/{waiting['id']}/cancel/"
        )
        self.assertIsNone(response.data["promoted"])

    def test_a_batch_with_no_capacity_never_fills(self):
        self.batch.capacity = None
        self.batch.save()
        for name in ("First", "Second", "Third"):
            self.assertEqual(self.book(self.paid_member(name)).data["status"], "booked")


class ClassCreditsTests(BookingTestCase):
    """The tier's weekly credits, which had no effect on anything until now."""

    def days_in_one_week(self, count):
        """Next week's Monday onwards: always in the future, always one week,
        whatever day the suite happens to run on."""
        monday = self.today + timedelta(days=7 - self.today.weekday())
        return [monday + timedelta(days=offset) for offset in range(count)]

    def test_a_plan_with_credits_runs_out(self):
        student = self.paid_member("Aarav", credits=2)
        days = self.days_in_one_week(3)

        self.assertEqual(self.book(student, day=days[0]).status_code, 201)
        self.assertEqual(self.book(student, day=days[1]).status_code, 201)

        third = self.book(student, day=days[2])
        self.assertEqual(third.status_code, 400)
        self.assertIn("all 2 classes", str(third.data))

    def test_cancelling_gives_a_credit_back(self):
        student = self.paid_member("Aarav", credits=1)
        days = self.days_in_one_week(2)

        created = self.book(student, day=days[0])
        self.assertEqual(self.book(student, day=days[1]).status_code, 400)

        self.client_for(self.manager).post(
            f"/api/batches/bookings/{created.data['id']}/cancel/"
        )
        self.assertEqual(self.book(student, day=days[1]).status_code, 201)

    def test_a_plan_without_credits_is_unlimited(self):
        student = self.paid_member("Aarav")
        for day in self.days_in_one_week(3):
            self.assertEqual(self.book(student, day=day).status_code, 201)

    def test_waiting_does_not_spend_a_credit(self):
        """Somebody waitlisted for three classes and given none should not
        have paid for three."""
        student = self.paid_member("Aarav", credits=1)
        for name in ("First", "Second"):
            self.book(self.paid_member(name))

        response = self.book(student)
        self.assertEqual(response.data["status"], "waitlisted")


class SessionsCalendarTests(BookingTestCase):
    def sessions(self, **params):
        query = "&".join(f"{k}={v}" for k, v in params.items())
        return self.client_for(self.manager).get(f"/api/batches/sessions/?{query}").data

    def test_it_lists_a_session_per_day_the_batch_runs(self):
        data = self.sessions(**{"from": str(self.today), "to": str(self.today + timedelta(days=2))})
        self.assertEqual(len(data["sessions"]), 3)

    def test_it_says_what_is_left(self):
        self.book(self.paid_member("Aarav"))
        row = next(
            s for s in self.sessions(**{"from": str(self.day), "to": str(self.day)})["sessions"]
            if s["batch"] == self.batch.id
        )
        self.assertEqual(row["taken"], 1)
        self.assertEqual(row["places_left"], 1)

    def test_it_counts_the_queue_separately(self):
        for name in ("First", "Second", "Third"):
            self.book(self.paid_member(name))
        row = self.sessions(**{"from": str(self.day), "to": str(self.day)})["sessions"][0]
        self.assertEqual(row["places_left"], 0)
        self.assertEqual(row["waiting"], 1)

    def test_a_batch_with_no_days_set_offers_no_sessions(self):
        """It would otherwise appear bookable every single day."""
        self.batch.days_of_week = []
        self.batch.save()
        data = self.sessions(**{"from": str(self.today), "to": str(self.today + timedelta(days=6))})
        self.assertEqual(data["sessions"], [])

    def test_a_batch_that_changes_its_days_leaves_no_phantom_sessions(self):
        """Sessions are worked out from the pattern, not stored."""
        self.batch.days_of_week = [self.day.weekday()]
        self.batch.save()
        days = {
            s["session_date"]
            for s in self.sessions(**{"from": str(self.today), "to": str(self.today + timedelta(days=6))})["sessions"]
        }
        self.assertEqual(days, {self.day})


class BookingMeetsAttendanceTests(BookingTestCase):
    def test_checking_in_settles_the_booking(self):
        """A place you booked and turned up for is attended, not still open."""
        from batches.models import Enrolment

        student = self.paid_member("Aarav")
        Enrolment.objects.create(
            batch=self.batch, student=student, enrolled_on=self.today, is_active=True
        )
        booking = self.book(student, day=self.today).data

        self.client_for(self.manager).post(
            "/api/attendance/checkins/", {"student": student.id}, format="json"
        )
        self.assertEqual(
            ClassBooking.objects.get(pk=booking["id"]).status, BookingStatus.ATTENDED
        )


class BookingIsolationTests(BookingTestCase):
    def test_another_academys_member_cannot_be_booked(self):
        outsider = Student.objects.create(
            academy=self.other_org, full_name="Theirs", joined_on=date(2026, 1, 1)
        )
        self.assertEqual(self.book(outsider).status_code, 400)

    def test_bookings_do_not_leak_across_academies(self):
        self.book(self.paid_member("Aarav"))
        response = self.client_for(self.other_owner, academy=self.other_org).get(
            "/api/batches/bookings/"
        )
        self.assertEqual(response.data["count"], 0)
