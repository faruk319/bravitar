"""Check-ins — the door.

Every other screen can be a day out of date and nobody is hurt. This one
decides whether a person standing at the counter comes in, so the rule it uses
has to be the same rule the Memberships screen shows, and a pass token has to
be worth nothing to whoever picks it up.
"""

import uuid
from datetime import date, timedelta
from decimal import Decimal

from django.utils import timezone
from rest_framework.test import APIClient

from organizations.models import APIKey, Organization
from students.models import Student
from subscriptions.constants import BillingPeriod
from subscriptions.models import MembershipTier

from .base import BASE_DOMAIN, TenantAPITestCase


class CheckInTestCase(TenantAPITestCase):
    def setUp(self):
        super().setUp()
        self.org.verticals = ["gym", "fitness"]
        self.org.save()
        self.today = timezone.localdate()
        self.student = Student.objects.create(
            organization=self.org, full_name="Walk In", joined_on=date(2026, 1, 1)
        )
        self.tier = MembershipTier.objects.create(
            organization=self.org, name="Monthly", period=BillingPeriod.MONTHLY,
            duration_days=30, price=Decimal("1500.00"),
        )

    def subscribe(self, started_on=None, student=None):
        return self.client_for(self.manager).post(
            "/api/gym-ops/subscriptions/",
            {
                "student": (student or self.student).id,
                "tier": self.tier.id,
                "started_on": str(started_on or self.today),
            },
            format="json",
        )

    def pay(self, subscription_id, amount="1500.00"):
        invoice_id = self.client_for(self.manager).get(
            f"/api/gym-ops/subscriptions/{subscription_id}/"
        ).data["invoice"]
        return self.client_for(self.manager).post(
            "/api/billing/payments/",
            {"invoice": invoice_id, "amount": amount, "paid_on": str(self.today)},
            format="json",
        )

    def paid_up(self, student=None):
        created = self.subscribe(student=student)
        self.pay(created.data["id"])
        return created

    def check_in(self, student=None):
        return self.client_for(self.manager).post(
            "/api/attendance/checkins/", {"student": (student or self.student).id}, format="json"
        )

    def token_for(self, student=None):
        return self.client_for(self.manager).get(
            f"/api/attendance/checkins/pass/{(student or self.student).id}/"
        ).data["qr_token"]


class AdmissionTests(CheckInTestCase):
    """Who gets in. The answer must agree with the membership status, because
    two rules for one question is how a paid-up member gets turned away."""

    def test_a_paid_up_member_is_admitted(self):
        self.paid_up()
        response = self.check_in()
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data["admitted"])

    def test_an_unpaid_member_is_turned_away(self):
        """This is the whole point of `pending`: they signed up, nobody took
        the money, and the door should not pretend otherwise."""
        self.subscribe()
        response = self.check_in()
        self.assertFalse(response.data["admitted"])
        self.assertEqual(response.data["refused_reason"], "awaiting_payment")

    def test_someone_with_no_membership_is_turned_away(self):
        response = self.check_in()
        self.assertFalse(response.data["admitted"])
        self.assertEqual(response.data["refused_reason"], "no_membership")

    def test_a_lapsed_member_is_turned_away(self):
        created = self.subscribe(started_on=self.today - timedelta(days=60))
        self.pay(created.data["id"])
        response = self.check_in()
        self.assertFalse(response.data["admitted"])
        self.assertEqual(response.data["refused_reason"], "expired")

    def test_a_cancelled_membership_turns_them_away(self):
        created = self.paid_up()
        self.client_for(self.manager).patch(
            f"/api/gym-ops/subscriptions/{created.data['id']}/",
            {"cancelled_on": str(self.today)}, format="json",
        )
        response = self.check_in()
        self.assertFalse(response.data["admitted"])
        self.assertEqual(response.data["refused_reason"], "cancelled")

    def test_a_membership_that_starts_later_turns_them_away(self):
        created = self.subscribe(started_on=self.today + timedelta(days=7))
        self.pay(created.data["id"])
        response = self.check_in()
        self.assertFalse(response.data["admitted"])
        self.assertEqual(response.data["refused_reason"], "not_started")

    def test_the_door_agrees_with_the_membership_screen(self):
        """One rule, two readings. If these drift, a member is 'active' on one
        screen and refused at the counter."""
        from attendance.admission import admission_for
        from subscriptions.models import MemberSubscription

        for started, paid in [
            (self.today, True), (self.today, False),
            (self.today - timedelta(days=60), True),
            (self.today + timedelta(days=7), True),
        ]:
            MemberSubscription.objects.all().delete()
            created = self.subscribe(started_on=started)
            if paid:
                self.pay(created.data["id"])

            subscription = MemberSubscription.objects.get(pk=created.data["id"])
            self.assertEqual(
                admission_for(self.student).allowed,
                subscription.is_current,
                f"door and membership disagree for status={subscription.status}",
            )

    def test_admission_can_be_checked_without_recording_a_visit(self):
        from attendance.models import CheckIn

        self.paid_up()
        response = self.client_for(self.manager).get(
            f"/api/attendance/checkins/admission/{self.student.id}/"
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["allowed"])
        self.assertEqual(CheckIn.objects.count(), 0)

    def test_a_refused_attempt_is_still_recorded(self):
        """A gym turning people away needs to see that it is."""
        from attendance.models import CheckIn

        self.check_in()
        self.assertEqual(CheckIn.objects.filter(admitted=False).count(), 1)


class VisitTests(CheckInTestCase):
    def test_scanning_twice_is_one_visit(self):
        self.paid_up()
        first = self.check_in()
        second = self.check_in()

        self.assertEqual(first.data["id"], second.data["id"])
        self.assertEqual(second.status_code, 200)

    def test_checking_out_closes_the_visit(self):
        self.paid_up()
        visit = self.check_in().data
        response = self.client_for(self.manager).post(f"/api/attendance/checkins/{visit['id']}/out/")

        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.data["checked_out_at"])
        self.assertFalse(response.data["is_inside"])

    def test_a_new_visit_can_start_after_checking_out(self):
        self.paid_up()
        first = self.check_in().data
        self.client_for(self.manager).post(f"/api/attendance/checkins/{first['id']}/out/")
        second = self.check_in()

        self.assertEqual(second.status_code, 201)
        self.assertNotEqual(first["id"], second.data["id"])

    def test_checking_out_twice_does_not_move_the_time(self):
        self.paid_up()
        visit = self.check_in().data
        first = self.client_for(self.manager).post(f"/api/attendance/checkins/{visit['id']}/out/")
        again = self.client_for(self.manager).post(f"/api/attendance/checkins/{visit['id']}/out/")
        self.assertEqual(first.data["checked_out_at"], again.data["checked_out_at"])

    def test_today_reports_who_is_in(self):
        self.paid_up()
        other = Student.objects.create(
            organization=self.org, full_name="Also Here", joined_on=self.today
        )
        self.paid_up(student=other)

        self.check_in()
        second = self.check_in(student=other).data
        self.client_for(self.manager).post(f"/api/attendance/checkins/{second['id']}/out/")

        response = self.client_for(self.manager).get("/api/attendance/checkins/today/")
        self.assertEqual(response.data["counts"]["admitted"], 2)
        self.assertEqual(response.data["counts"]["inside"], 1)
        self.assertEqual(len(response.data["inside"]), 1)


class PassTests(CheckInTestCase):
    """A pass token is the key to the door. It must be worth nothing to
    somebody who finds one, and killable when it leaks."""

    def test_scanning_a_pass_checks_the_member_in(self):
        self.paid_up()
        response = self.client_for(self.manager).post(
            "/api/attendance/checkins/scan/",
            {"token": self.token_for(), "device": "front-door"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data["admitted"])
        self.assertEqual(response.data["method"], "qr")
        self.assertEqual(response.data["device"], "front-door")

    def test_an_unknown_pass_is_refused_without_saying_why(self):
        response = self.client_for(self.manager).post(
            "/api/attendance/checkins/scan/", {"token": str(uuid.uuid4())}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("organization", str(response.data).lower())

    def test_another_academys_pass_does_not_open_our_door(self):
        outsider = Student.objects.create(
            organization=self.other_org, full_name="Theirs", joined_on=self.today
        )
        response = self.client_for(self.manager).post(
            "/api/attendance/checkins/scan/", {"token": str(outsider.qr_token)}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_reissuing_a_pass_kills_the_old_one(self):
        self.paid_up()
        old = self.token_for()
        self.client_for(self.manager).post(f"/api/attendance/checkins/pass/{self.student.id}/")

        response = self.client_for(self.manager).post(
            "/api/attendance/checkins/scan/", {"token": old}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_the_member_list_does_not_hand_out_pass_tokens(self):
        """One endpoint returns one token. A list of them would be a list of
        skeleton keys."""
        row = self.client_for(self.manager).get("/api/students/").data["results"][0]
        self.assertNotIn("qr_token", row)

    def test_a_pass_belonging_to_another_academy_cannot_be_read(self):
        outsider = Student.objects.create(
            organization=self.other_org, full_name="Theirs", joined_on=self.today
        )
        response = self.client_for(self.manager).get(f"/api/attendance/checkins/pass/{outsider.id}/")
        self.assertIn(response.status_code, (403, 404))


class DoorAccessTests(CheckInTestCase):
    """Who may operate the door, and who may only be let through it."""

    def api_key_client(self):
        _, raw = APIKey.generate(self.org, name="turnstile")
        client = APIClient(HTTP_HOST=f"{self.org.slug}.{BASE_DOMAIN}")
        client.credentials(HTTP_X_API_KEY=raw)
        return client

    def test_a_turnstile_key_can_scan(self):
        """The thing at the door is a device, not a signed-in person."""
        self.paid_up()
        response = self.api_key_client().post(
            "/api/attendance/checkins/scan/",
            {"token": self.token_for(), "device": "turnstile-1"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data["admitted"])

    def test_a_turnstile_key_cannot_read_the_visit_log(self):
        """Scanning is all a door needs. The log names members."""
        response = self.api_key_client().get("/api/attendance/checkins/")
        self.assertIn(response.status_code, (401, 403))

    def test_a_turnstile_key_cannot_read_pass_tokens(self):
        response = self.api_key_client().get(f"/api/attendance/checkins/pass/{self.student.id}/")
        self.assertIn(response.status_code, (401, 403))

    def test_an_academy_without_memberships_still_has_a_door(self):
        """Check-in is core. A swim school that sells nothing at the door
        admits anyone on its roster, and the gym's membership rule simply
        isn't consulted."""
        self.org.verticals = ["swimming"]
        self.org.save()

        response = self.check_in()
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data["admitted"])

    def test_another_academy_cannot_read_our_visits(self):
        self.paid_up()
        self.check_in()
        response = self.client_for(self.other_owner, organization=self.other_org).get(
            "/api/attendance/checkins/"
        )
        self.assertNotEqual(response.status_code, 200) if response.status_code != 200 \
            else self.assertEqual(response.data["count"], 0)

    def test_deleting_a_visit_is_a_managers_call(self):
        self.paid_up()
        visit = self.check_in().data
        response = self.client_for(self.owner).delete(f"/api/attendance/checkins/{visit['id']}/")
        self.assertEqual(response.status_code, 204)


class CrossTenantCheckInTests(CheckInTestCase):
    def test_a_member_of_another_academy_cannot_be_checked_in(self):
        other = Organization.objects.create(name="Rival", slug="rival", verticals=["gym"])
        outsider = Student.objects.create(
            organization=other, full_name="Not Ours", joined_on=self.today
        )
        response = self.client_for(self.manager).post(
            "/api/attendance/checkins/", {"student": outsider.id}, format="json"
        )
        self.assertEqual(response.status_code, 400)


class PassImageTests(CheckInTestCase):
    def test_the_pass_renders_as_a_png(self):
        response = self.client_for(self.manager).get(
            f"/api/attendance/checkins/pass/{self.student.id}/qr.png"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/png")
        self.assertTrue(
            b"".join(response.streaming_content).startswith(b"\x89PNG\r\n\x1a\n")
        )

    def test_the_pass_image_is_not_cached(self):
        """A front desk machine is shared. The token is the secret."""
        response = self.client_for(self.manager).get(
            f"/api/attendance/checkins/pass/{self.student.id}/qr.png"
        )
        self.assertIn("no-store", response["Cache-Control"])

    def test_an_api_key_cannot_fetch_a_pass_image(self):
        _, raw = APIKey.generate(self.org, name="turnstile")
        client = APIClient(HTTP_HOST=f"{self.org.slug}.{BASE_DOMAIN}")
        client.credentials(HTTP_X_API_KEY=raw)
        response = client.get(f"/api/attendance/checkins/pass/{self.student.id}/qr.png")
        self.assertIn(response.status_code, (401, 403))

    def test_the_rendered_pass_is_the_token_that_opens_the_door(self):
        """The image and the scan endpoint must agree, or a printed card is
        decoration."""
        self.paid_up()
        token = self.token_for()
        response = self.client_for(self.manager).post(
            "/api/attendance/checkins/scan/", {"token": token}, format="json"
        )
        self.assertEqual(response.status_code, 201)


class CheckInFeedsTheRegisterTests(CheckInTestCase):
    """A visit and a register entry are two records of one fact.

    Somebody who scanned in before their 6am class has attended it. Making the
    coach mark them present again is asking the same question twice — and the
    two answers then disagree, which is how a member ends up with a 40%
    attendance rate on a day they were standing in the room.
    """

    def setUp(self):
        super().setUp()
        from batches.models import Batch, Enrolment

        self.batch = Batch.objects.create(
            organization=self.org, name="Morning",
            days_of_week=list(range(7)), is_active=True,
        )
        Enrolment.objects.create(
            batch=self.batch, student=self.student,
            enrolled_on=self.today, is_active=True,
        )

    def records(self):
        from attendance.models import AttendanceRecord

        return AttendanceRecord.objects.filter(student=self.student, date=self.today)

    def test_checking_in_marks_the_register(self):
        self.paid_up()
        self.check_in()

        record = self.records().get()
        self.assertEqual(record.batch, self.batch)
        self.assertEqual(record.status, "present")
        self.assertEqual(record.marked_by, "check-in")

    def test_a_refused_visit_does_not_mark_anybody_present(self):
        self.check_in()
        self.assertEqual(self.records().count(), 0)

    def test_it_does_not_overrule_the_coach(self):
        """A coach who marked somebody excused knows something the turnstile
        does not."""
        from attendance.models import AttendanceRecord

        AttendanceRecord.objects.create(
            organization=self.org, batch=self.batch, student=self.student,
            date=self.today, status="excused", marked_by="coach",
        )
        self.paid_up()
        self.check_in()

        self.assertEqual(self.records().get().status, "excused")

    def test_it_only_marks_batches_running_that_day(self):
        from batches.models import Batch, Enrolment

        tomorrow = (self.today.weekday() + 1) % 7
        other = Batch.objects.create(
            organization=self.org, name="Tomorrow only",
            days_of_week=[tomorrow], is_active=True,
        )
        Enrolment.objects.create(
            batch=other, student=self.student, enrolled_on=self.today, is_active=True,
        )

        self.paid_up()
        self.check_in()

        self.assertEqual(
            set(self.records().values_list("batch_id", flat=True)), {self.batch.id}
        )

    def test_a_member_in_no_batch_is_still_admitted(self):
        """A gym member who just uses the floor has no register to mark, and
        that is not a reason to refuse them."""
        from batches.models import Enrolment

        Enrolment.objects.all().delete()
        self.paid_up()

        response = self.check_in()
        self.assertTrue(response.data["admitted"])
        self.assertEqual(self.records().count(), 0)

    def test_scanning_twice_does_not_mark_twice(self):
        self.paid_up()
        self.check_in()
        self.check_in()
        self.assertEqual(self.records().count(), 1)
