"""Role boundaries.

The ladder is owner > manager > staff, each including everything below it.
Members are not sign-in-able yet: they are tracked as Student records, and a
member-role Membership grants nothing until that is switched on.
"""

from datetime import date

from organizations.constants import Role
from students.models import Student

from .base import TenantAPITestCase


class MemberSignInIsOffTests(TenantAPITestCase):
    def test_a_member_cannot_read_anything(self):
        for path in ["/api/students/", "/api/batches/", "/api/billing/invoices/"]:
            with self.subTest(path=path):
                self.assertEqual(self.client_for(self.member).get(path).status_code, 403)

    def test_the_refusal_explains_itself(self):
        response = self.client_for(self.member).get("/api/students/")
        self.assertIn("Member sign-in", str(response.data["detail"]))

    def test_a_member_cannot_reach_their_own_gym_data_either(self):
        """Not a half-open door: while sign-in is off it is off everywhere."""
        response = self.client_for(self.member).post(
            "/api/gym/routines/", {"name": "Mine", "items": []}, format="json"
        )
        self.assertEqual(response.status_code, 403)

    def test_a_member_is_not_shown_an_academy_they_cannot_open(self):
        client = self.client_for(self.member)
        client.defaults["HTTP_HOST"] = "testserver"
        response = client.get("/api/organizations/mine/")
        self.assertEqual(response.data["count"], 0)

    def test_member_is_not_an_assignable_role(self):
        response = self.client_for(self.owner).post(
            "/api/organizations/current/team/",
            {"email": "new@example.com", "role": Role.MEMBER}, format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_the_membership_row_survives_for_later(self):
        """Switching member sign-in on must not require re-inviting anyone."""
        from organizations.models import Membership

        self.assertTrue(
            Membership.objects.filter(organization=self.org, role=Role.MEMBER).exists()
        )


class StaffBoundaryTests(TenantAPITestCase):
    def test_staff_run_the_academy(self):
        response = self.client_for(self.staff).post(
            "/api/students/", {"full_name": "New", "joined_on": "2026-01-01"}, format="json"
        )
        self.assertEqual(response.status_code, 201)

    def test_staff_can_mark_a_register(self):
        batch = self.client_for(self.staff).post(
            "/api/batches/", {"name": "Morning", "days_of_week": [0]}, format="json"
        ).data
        response = self.client_for(self.staff).post(
            "/api/attendance/mark/",
            {"batch": batch["id"], "date": "2026-01-05", "marks": []}, format="json",
        )
        self.assertNotEqual(response.status_code, 403)

    def test_staff_can_read_the_books_but_not_change_them(self):
        # Every read the billing screen makes, not just the list — one 403
        # among them blanks the whole page.
        for path in ["/api/billing/invoices/", "/api/billing/summary/", "/api/billing/plans/"]:
            with self.subTest(path=path):
                self.assertEqual(self.client_for(self.staff).get(path).status_code, 200)
        student = Student.objects.create(
            organization=self.org, full_name="Payer", joined_on=date(2026, 1, 1)
        )
        response = self.client_for(self.staff).post(
            "/api/billing/invoices/",
            {"student": student.id, "amount": "100.00",
             "issued_on": "2026-01-01", "due_on": "2026-02-01"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_staff_cannot_invite_or_change_settings(self):
        self.assertEqual(
            self.client_for(self.staff).post(
                "/api/organizations/current/team/",
                {"email": "x@example.com", "role": Role.STAFF}, format="json",
            ).status_code, 403,
        )
        self.assertEqual(
            self.client_for(self.staff).patch(
                "/api/organizations/current/", {"name": "Renamed"}, format="json"
            ).status_code, 403,
        )


class ManagerBoundaryTests(TenantAPITestCase):
    def test_a_manager_can_do_everything_staff_can(self):
        response = self.client_for(self.manager).post(
            "/api/students/", {"full_name": "New", "joined_on": "2026-01-01"}, format="json"
        )
        self.assertEqual(response.status_code, 201)

    def test_a_manager_handles_the_money(self):
        student = Student.objects.create(
            organization=self.org, full_name="Payer", joined_on=date(2026, 1, 1)
        )
        response = self.client_for(self.manager).post(
            "/api/billing/invoices/",
            {"student": student.id, "amount": "100.00",
             "issued_on": "2026-01-01", "due_on": "2026-02-01"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)

    def test_a_manager_can_read_the_team(self):
        self.assertEqual(
            self.client_for(self.manager).get("/api/organizations/current/team/").status_code,
            200,
        )

    def test_a_manager_cannot_invite_or_change_settings(self):
        """Managers run the academy; who has keys to it stays with the owner."""
        self.assertEqual(
            self.client_for(self.manager).post(
                "/api/organizations/current/team/",
                {"email": "x@example.com", "role": Role.STAFF}, format="json",
            ).status_code, 403,
        )
        self.assertEqual(
            self.client_for(self.manager).patch(
                "/api/organizations/current/", {"name": "Renamed"}, format="json"
            ).status_code, 403,
        )

    def test_a_manager_can_be_invited(self):
        response = self.client_for(self.owner).post(
            "/api/organizations/current/team/",
            {"email": "newmanager@example.com", "role": Role.MANAGER}, format="json",
        )
        self.assertEqual(response.status_code, 201)


class OutsiderTests(TenantAPITestCase):
    def test_a_signed_in_stranger_is_refused(self):
        self.assertEqual(self.client_for(self.outsider).get("/api/students/").status_code, 403)

    def test_anonymous_is_refused(self):
        self.assertEqual(self.client_for(None).get("/api/students/").status_code, 403)

    def test_a_stranger_cannot_write(self):
        response = self.client_for(self.outsider).post(
            "/api/students/", {"full_name": "New", "joined_on": "2026-01-01"}, format="json"
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(Student.objects.filter(organization=self.org).count(), 0)
