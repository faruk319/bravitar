"""Role boundaries: member reads, staff runs the academy, owner controls it."""

from datetime import date

from students.models import Student

from .base import TenantAPITestCase


class MemberBoundaryTests(TenantAPITestCase):
    def test_member_can_read_the_roster(self):
        self.assertEqual(self.client_for(self.member).get("/api/students/").status_code, 200)

    def test_member_cannot_add_a_student(self):
        response = self.client_for(self.member).post(
            "/api/students/", {"full_name": "New", "joined_on": "2026-01-01"}, format="json"
        )
        self.assertEqual(response.status_code, 403)

    def test_member_cannot_mark_a_register(self):
        response = self.client_for(self.member).post(
            "/api/attendance/mark/", {"batch": 1, "date": "2026-01-01", "marks": []},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_member_cannot_add_a_custom_exercise(self):
        response = self.client_for(self.member).post(
            "/api/gym/exercises/", {"name": "Mine", "primary_muscle": "abs"}, format="json"
        )
        self.assertEqual(response.status_code, 403)

    def test_member_cannot_see_the_team(self):
        self.assertEqual(
            self.client_for(self.member).get("/api/organizations/current/team/").status_code, 403
        )

    def test_member_keeps_their_own_gym_data(self):
        """Members are restricted from academy admin, not from their own
        training — the distinction matters or the app is useless to them."""
        response = self.client_for(self.member).post(
            "/api/gym/routines/", {"name": "My routine", "items": []}, format="json"
        )
        self.assertEqual(response.status_code, 201)


class StaffBoundaryTests(TenantAPITestCase):
    def test_staff_can_add_a_student(self):
        response = self.client_for(self.staff).post(
            "/api/students/", {"full_name": "New", "joined_on": "2026-01-01"}, format="json"
        )
        self.assertEqual(response.status_code, 201)

    def test_staff_can_read_the_team(self):
        self.assertEqual(
            self.client_for(self.staff).get("/api/organizations/current/team/").status_code, 200
        )

    def test_staff_cannot_invite(self):
        response = self.client_for(self.staff).post(
            "/api/organizations/current/team/",
            {"email": "x@example.com", "role": "staff"}, format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_staff_cannot_change_settings(self):
        response = self.client_for(self.staff).patch(
            "/api/organizations/current/", {"name": "Renamed"}, format="json"
        )
        self.assertEqual(response.status_code, 403)
        self.org.refresh_from_db()
        self.assertEqual(self.org.name, "Iron Temple")


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
