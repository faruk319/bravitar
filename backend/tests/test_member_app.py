"""The member's own view of their record.

The load-bearing question here is not what a member can do but what they
cannot: reach somebody else's record, grant themselves a login, or slip past
a rule the front desk has to obey.
"""

from datetime import date, timedelta
from decimal import Decimal

from django.utils import timezone

from batches.models import Batch, BookingStatus, ClassBooking, Enrolment
from students.models import Student
from subscriptions.constants import BillingPeriod
from subscriptions.models import MembershipTier

from .base import TenantAPITestCase, make_user


class MemberAppTestCase(TenantAPITestCase):
    def setUp(self):
        super().setUp()
        self.today = timezone.localdate()
        self.day = self.today + timedelta(days=1)
        self.tier = MembershipTier.objects.create(
            academy=self.org, name="Monthly", period=BillingPeriod.MONTHLY,
            duration_days=30, price=Decimal("1500.00"),
        )
        self.batch = Batch.objects.create(
            academy=self.org, name="Morning HIIT",
            days_of_week=list(range(7)), capacity=2, is_active=True,
        )

    def enrolled(self, name, email="", paid=True):
        student = Student.objects.create(
            academy=self.org, full_name=name, email=email, joined_on=date(2026, 1, 1)
        )
        created = self.client_for(self.manager).post(
            "/api/gym-ops/subscriptions/",
            {"student": student.id, "tier": self.tier.id, "started_on": str(self.today)},
            format="json",
        )
        if paid:
            invoice = self.client_for(self.manager).get(
                f"/api/gym-ops/subscriptions/{created.data['id']}/"
            ).data["invoice"]
            self.client_for(self.manager).post(
                "/api/billing/payments/",
                {"invoice": invoice, "amount": "1500.00", "paid_on": str(self.today)},
                format="json",
            )
        return student

    def invite(self, student):
        return self.client_for(self.manager).post(
            f"/api/students/{student.id}/invite/", {}, format="json"
        )

    def signed_in(self, student, user_id="member-user-1", verified=True):
        """The member themselves, arriving with a Supabase account."""
        return self.client_for(
            make_user(user_id, student.email, email_verified=verified)
        )


class InvitingAMemberTests(MemberAppTestCase):
    def test_an_invited_member_can_reach_their_own_record(self):
        student = self.enrolled("Aarav", email="aarav@example.com")
        self.assertEqual(self.invite(student).status_code, 200)

        response = self.signed_in(student).get("/api/member/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["members"]), 1)
        self.assertEqual(response.data["members"][0]["full_name"], "Aarav")

    def test_an_uninvited_member_gets_nothing(self):
        """An email on a record is a contact detail, not a grant of access."""
        student = self.enrolled("Aarav", email="aarav@example.com")
        response = self.signed_in(student).get("/api/member/")
        self.assertEqual(response.status_code, 403)

    def test_an_unverified_address_claims_nothing(self):
        """Otherwise signing up with somebody else's invited email would hand
        over their record."""
        student = self.enrolled("Aarav", email="aarav@example.com")
        self.invite(student)
        response = self.signed_in(student, verified=False).get("/api/member/")
        self.assertEqual(response.status_code, 403)

    def test_a_member_with_no_email_cannot_be_invited(self):
        student = self.enrolled("Aarav")
        response = self.invite(student)
        self.assertEqual(response.status_code, 400)
        self.assertIn("no email", str(response.data))

    def test_withdrawing_the_invite_locks_them_out_again(self):
        student = self.enrolled("Aarav", email="aarav@example.com")
        self.invite(student)
        client = self.signed_in(student)
        self.assertEqual(client.get("/api/member/").status_code, 200)

        self.client_for(self.manager).post(
            f"/api/students/{student.id}/invite/", {"allowed": False}, format="json"
        )
        self.assertEqual(client.get("/api/member/").status_code, 403)

    def test_the_record_survives_the_login_being_taken_away(self):
        student = self.enrolled("Aarav", email="aarav@example.com")
        self.invite(student)
        self.client_for(self.manager).post(
            f"/api/students/{student.id}/invite/", {"allowed": False}, format="json"
        )
        student.refresh_from_db()
        self.assertEqual(student.full_name, "Aarav")
        self.assertEqual(student.subscriptions.count(), 1)

    def test_a_record_cannot_be_handed_to_an_account_by_editing_it(self):
        """user_id says whose record this is. If editing a member could set
        it, anyone who can edit members could point one at their own login."""
        student = self.enrolled("Aarav", email="aarav@example.com")
        self.client_for(self.manager).patch(
            f"/api/students/{student.id}/",
            {"user_id": "attacker-1", "invited_at": "2026-01-01T00:00:00Z"},
            format="json",
        )
        student.refresh_from_db()
        self.assertEqual(student.user_id, "")
        self.assertIsNone(student.invited_at)

    def test_staff_cannot_invite(self):
        """Handing out logins is a manager's call."""
        student = self.enrolled("Aarav", email="aarav@example.com")
        response = self.client_for(self.staff).post(
            f"/api/students/{student.id}/invite/", {}, format="json"
        )
        self.assertIn(response.status_code, (403, 404))

    def test_one_login_covers_several_children(self):
        """A parent's account reaches each of their children."""
        first = self.enrolled("Ira", email="parent@example.com")
        second = self.enrolled("Kabir", email="parent@example.com")
        self.invite(first)
        self.invite(second)

        response = self.signed_in(first).get("/api/member/")
        names = sorted(m["full_name"] for m in response.data["members"])
        self.assertEqual(names, ["Ira", "Kabir"])


class SomebodyElsesRecordTests(MemberAppTestCase):
    def setUp(self):
        super().setUp()
        self.mine = self.enrolled("Aarav", email="aarav@example.com")
        self.theirs = self.enrolled("Diya", email="diya@example.com")
        self.invite(self.mine)
        self.invite(self.theirs)
        self.client = self.signed_in(self.mine)

    def test_another_members_record_is_not_found(self):
        """404 rather than 403 — whether an id exists is not something to
        confirm to somebody it doesn't belong to."""
        self.assertEqual(
            self.client.get(f"/api/member/{self.theirs.id}/").status_code, 404
        )

    def test_another_members_money_is_not_found(self):
        self.assertEqual(
            self.client.get(f"/api/member/{self.theirs.id}/invoices/").status_code, 404
        )

    def test_a_place_cannot_be_booked_in_another_members_name(self):
        response = self.client.post(
            f"/api/member/{self.theirs.id}/bookings/",
            {"batch": self.batch.id, "session_date": str(self.day)},
            format="json",
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(ClassBooking.objects.count(), 0)

    def test_a_member_of_another_academy_is_not_reachable(self):
        outsider = Student.objects.create(
            academy=self.other_org, full_name="Theirs",
            email="aarav@example.com", joined_on=date(2026, 1, 1),
        )
        outsider.invited_at = timezone.now()
        outsider.save()
        self.assertEqual(
            self.client.get(f"/api/member/{outsider.id}/").status_code, 404
        )


class WhatAMemberMayChangeTests(MemberAppTestCase):
    def setUp(self):
        super().setUp()
        self.student = self.enrolled("Aarav", email="aarav@example.com")
        self.invite(self.student)
        self.client = self.signed_in(self.student)

    def test_they_can_update_their_own_contact_details(self):
        response = self.client.patch(
            f"/api/member/{self.student.id}/",
            {"phone": "9000000001", "guardian_phone": "9000000002"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.student.refresh_from_db()
        self.assertEqual(self.student.phone, "9000000001")

    def test_they_cannot_rename_themselves(self):
        """The name is the academy's record of them, not a preference."""
        self.client.patch(
            f"/api/member/{self.student.id}/", {"full_name": "Someone Else"},
            format="json",
        )
        self.student.refresh_from_db()
        self.assertEqual(self.student.full_name, "Aarav")

    def test_they_cannot_move_their_own_join_date(self):
        """The money history is dated from it."""
        original = self.student.joined_on
        self.client.patch(
            f"/api/member/{self.student.id}/", {"joined_on": "2020-01-01"}, format="json"
        )
        self.student.refresh_from_db()
        self.assertEqual(self.student.joined_on, original)

    def test_they_cannot_change_their_own_branch_or_status(self):
        self.client.patch(
            f"/api/member/{self.student.id}/", {"status": "left"}, format="json"
        )
        self.student.refresh_from_db()
        self.assertEqual(self.student.status, "active")


class MemberBookingTests(MemberAppTestCase):
    def setUp(self):
        super().setUp()
        self.student = self.enrolled("Aarav", email="aarav@example.com")
        self.invite(self.student)
        self.client = self.signed_in(self.student)

    def act(self, action, day=None, batch=None):
        return self.client.post(
            f"/api/member/{self.student.id}/bookings/",
            {
                "action": action,
                "batch": (batch or self.batch).id,
                "session_date": str(day or self.day),
            },
            format="json",
        )

    def test_a_member_can_book_their_own_place(self):
        response = self.act("book")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["status"], "booked")

    def test_a_full_session_puts_them_on_the_waitlist(self):
        for name in ("First", "Second"):
            other = self.enrolled(name)
            self.client_for(self.manager).post(
                "/api/batches/bookings/",
                {"student": other.id, "batch": self.batch.id,
                 "session_date": str(self.day)},
                format="json",
            )
        self.assertEqual(self.act("book").data["status"], "waitlisted")

    def test_they_can_give_their_place_up(self):
        self.act("book")
        self.assertEqual(self.act("cancel").status_code, 200)
        self.assertEqual(ClassBooking.places_taken(self.batch, self.day), 0)

    def test_a_regular_can_say_they_are_not_coming(self):
        Enrolment.objects.create(
            batch=self.batch, student=self.student,
            enrolled_on=self.today, is_active=True,
        )
        self.assertEqual(ClassBooking.places_taken(self.batch, self.day), 1)

        response = self.act("away")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(ClassBooking.places_taken(self.batch, self.day), 0)

    def test_a_regular_can_take_the_day_back(self):
        Enrolment.objects.create(
            batch=self.batch, student=self.student,
            enrolled_on=self.today, is_active=True,
        )
        self.act("away")
        self.assertEqual(self.act("coming").status_code, 200)
        self.assertEqual(ClassBooking.places_taken(self.batch, self.day), 1)

    def test_somebody_who_is_not_a_regular_cannot_skip(self):
        response = self.act("away")
        self.assertEqual(response.status_code, 400)
        self.assertIn("not in this class", str(response.data))

    def test_the_desks_rules_still_apply(self):
        """The member app must not be a way round a rule the desk obeys."""
        unpaid = self.enrolled("Owes Money", email="owes@example.com", paid=False)
        self.invite(unpaid)
        response = self.signed_in(unpaid, user_id="member-user-2").post(
            f"/api/member/{unpaid.id}/bookings/",
            {"batch": self.batch.id, "session_date": str(self.day)},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("payment", str(response.data).lower())

    def test_a_past_day_is_refused(self):
        response = self.act("book", day=self.today - timedelta(days=1))
        self.assertEqual(response.status_code, 400)

    def test_sessions_say_where_they_stand(self):
        Enrolment.objects.create(
            batch=self.batch, student=self.student,
            enrolled_on=self.today, is_active=True,
        )
        rows = self.client.get(f"/api/member/{self.student.id}/sessions/").data["sessions"]
        row = next(r for r in rows if r["session_date"] == self.day)
        self.assertEqual(row["standing"], "regular")

    def test_a_booked_session_says_so(self):
        self.act("book")
        rows = self.client.get(f"/api/member/{self.student.id}/sessions/").data["sessions"]
        row = next(r for r in rows if r["session_date"] == self.day)
        self.assertEqual(row["standing"], "booked")


class MemberOverviewTests(MemberAppTestCase):
    def test_it_says_whether_they_may_train(self):
        student = self.enrolled("Aarav", email="aarav@example.com")
        self.invite(student)
        data = self.signed_in(student).get(f"/api/member/{student.id}/overview/").data
        self.assertTrue(data["may_train"])
        self.assertEqual(data["plan"]["name"], "Monthly")

    def test_an_unpaid_member_is_told_why_not(self):
        student = self.enrolled("Owes Money", email="owes@example.com", paid=False)
        self.invite(student)
        data = self.signed_in(student).get(f"/api/member/{student.id}/overview/").data
        self.assertFalse(data["may_train"])
        self.assertIsNotNone(data["why_not"])
        self.assertEqual(Decimal(str(data["owed"])), Decimal("1500.00"))


class StaffAreNotMembersTests(MemberAppTestCase):
    def test_a_manager_with_no_member_record_gets_nothing(self):
        """The member app answers for a person's own record. A manager has
        none, and should not be handed somebody else's."""
        self.assertEqual(self.client_for(self.manager).get("/api/member/").status_code, 403)

    def test_an_api_key_cannot_act_for_a_person(self):
        """A key belongs to the academy, so it has no person to be.

        Patched to carry an id on purpose: the guard must hold on its own,
        not because APIKeyPrincipal.id happens to be None today. A door
        reader that could read every member's invoices would be a bad way to
        find that assumption out.
        """
        from unittest.mock import patch

        from accounts.authentication import APIKeyPrincipal
        from organizations.models import APIKey

        student = self.enrolled("Aarav", email="aarav@example.com")
        self.invite(student)
        self.signed_in(student).get("/api/member/")   # claim it
        student.refresh_from_db()

        _, raw = APIKey.generate(self.org.organization, name="Door")
        with patch.object(APIKeyPrincipal, "id", student.user_id):
            response = self.client_for(None).get("/api/member/", HTTP_X_API_KEY=raw)
        self.assertEqual(response.status_code, 403)
