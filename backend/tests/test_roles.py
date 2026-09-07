"""Role boundaries.

The ladder is owner > manager > staff > member, but only owner and manager
can sign in today: the product is being built around the two roles that run
an academy. Staff and member are fully wired and switched off, and their rows
are kept so nobody has to be re-invited when they are enabled.
"""

from datetime import date

from organizations.constants import Role
from organizations.models import Membership
from students.models import Student

from .base import TenantAPITestCase

SWITCHED_OFF = [Role.STAFF, Role.MEMBER]


class SwitchedOffRoleTests(TenantAPITestCase):
    def actors(self):
        return {Role.STAFF: self.staff, Role.MEMBER: self.member}

    def test_a_switched_off_role_cannot_read_anything(self):
        for role, actor in self.actors().items():
            for path in ["/api/students/", "/api/batches/", "/api/billing/invoices/"]:
                with self.subTest(role=role, path=path):
                    self.assertEqual(self.client_for(actor).get(path).status_code, 403)

    def test_the_refusal_names_the_role(self):
        response = self.client_for(self.staff).get("/api/students/")
        self.assertIn("sign-in isn't available yet", str(response.data["detail"]))
        self.assertIn("Staff", str(response.data["detail"]))

    def test_a_switched_off_role_cannot_write(self):
        for role, actor in self.actors().items():
            with self.subTest(role=role):
                response = self.client_for(actor).post(
                    "/api/students/", {"full_name": "X", "joined_on": "2026-01-01"},
                    format="json",
                )
                self.assertEqual(response.status_code, 403)

    def test_they_are_not_shown_an_academy_they_cannot_open(self):
        for role, actor in self.actors().items():
            with self.subTest(role=role):
                client = self.client_for(actor)
                client.defaults["HTTP_HOST"] = "testserver"
                self.assertEqual(client.get("/api/organizations/mine/").data["count"], 0)

    def test_switched_off_roles_cannot_be_handed_out(self):
        for role in SWITCHED_OFF:
            with self.subTest(role=role):
                response = self.client_for(self.owner).post(
                    "/api/organizations/current/team/",
                    {"email": f"{role}@example.com", "role": role}, format="json",
                )
                self.assertEqual(response.status_code, 400)

    def test_their_rows_survive_for_later(self):
        """Enabling a role must not mean re-inviting everyone who had it."""
        for role in SWITCHED_OFF:
            with self.subTest(role=role):
                self.assertTrue(
                    Membership.objects.filter(organization=self.org, role=role).exists()
                )


class ManagerBoundaryTests(TenantAPITestCase):
    def test_a_manager_runs_the_academy(self):
        response = self.client_for(self.manager).post(
            "/api/students/", {"full_name": "New", "joined_on": "2026-01-01"}, format="json"
        )
        self.assertEqual(response.status_code, 201)

    def test_a_manager_marks_registers(self):
        batch = self.client_for(self.manager).post(
            "/api/batches/", {"name": "Morning", "days_of_week": [0]}, format="json"
        ).data
        response = self.client_for(self.manager).post(
            "/api/attendance/mark/",
            {"batch": batch["id"], "date": "2026-01-05", "marks": []}, format="json",
        )
        self.assertNotEqual(response.status_code, 403)

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

    def test_a_manager_reads_every_part_of_the_billing_screen(self):
        """One 403 among these blanks the whole page, so check them all."""
        for path in ["/api/billing/invoices/", "/api/billing/summary/", "/api/billing/plans/"]:
            with self.subTest(path=path):
                self.assertEqual(self.client_for(self.manager).get(path).status_code, 200)

    def test_a_manager_can_read_the_team(self):
        self.assertEqual(
            self.client_for(self.manager).get("/api/organizations/current/team/").status_code,
            200,
        )

    def test_a_manager_cannot_invite_or_change_settings(self):
        """Managers run the academy; who holds the keys stays with the owner."""
        self.assertEqual(
            self.client_for(self.manager).post(
                "/api/organizations/current/team/",
                {"email": "x@example.com", "role": Role.MANAGER}, format="json",
            ).status_code, 403,
        )
        self.assertEqual(
            self.client_for(self.manager).patch(
                "/api/organizations/current/", {"name": "Renamed"}, format="json"
            ).status_code, 403,
        )


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


class VerticalAvailabilityTests(TenantAPITestCase):
    def test_a_vertical_without_a_plugin_cannot_be_selected(self):
        response = self.client_for(self.owner).patch(
            "/api/organizations/current/", {"verticals": ["gym", "dance"]}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Not available yet", str(response.data["verticals"]))

    def test_an_academy_already_on_one_keeps_it(self):
        """Withdrawing a vertical must not strand whoever already had it."""
        self.org.verticals = ["dance"]
        self.org.save()

        response = self.client_for(self.owner).patch(
            "/api/organizations/current/", {"verticals": ["dance", "gym"]}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(sorted(response.data["verticals"]), ["dance", "gym"])
