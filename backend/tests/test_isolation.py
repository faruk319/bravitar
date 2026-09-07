"""Cross-tenant isolation.

The failure this guards against is the worst one a multi-tenant product can
have: one academy seeing, or writing into, another's records. Every scoped
app is checked, because a single view that forgets its filter is enough.
"""

from datetime import date
from decimal import Decimal

from billing.models import Invoice
from enquiries.models import Enquiry
from exercises.models import Exercise
from students.models import Student

from .base import TenantAPITestCase


class ReadIsolationTests(TenantAPITestCase):
    def setUp(self):
        super().setUp()
        self.mine = Student.objects.create(
            organization=self.org, full_name="Our Student", joined_on=date(2026, 1, 1)
        )
        self.theirs = Student.objects.create(
            organization=self.other_org, full_name="Their Student", joined_on=date(2026, 1, 1)
        )

    def test_student_list_shows_only_this_organization(self):
        response = self.client_for(self.owner).get("/api/students/")
        names = [row["full_name"] for row in response.data["results"]]
        self.assertEqual(names, ["Our Student"])

    def test_another_organizations_student_is_not_fetchable_by_id(self):
        response = self.client_for(self.owner).get(f"/api/students/{self.theirs.id}/")
        self.assertEqual(response.status_code, 404)

    def test_another_organizations_student_cannot_be_edited(self):
        response = self.client_for(self.owner).patch(
            f"/api/students/{self.theirs.id}/", {"full_name": "Renamed"}, format="json"
        )
        self.assertEqual(response.status_code, 404)
        self.theirs.refresh_from_db()
        self.assertEqual(self.theirs.full_name, "Their Student")

    def test_enquiries_are_isolated(self):
        Enquiry.objects.create(organization=self.other_org, name="Their Lead")
        response = self.client_for(self.owner).get("/api/enquiries/")
        self.assertEqual(response.data["count"], 0)

    def test_invoices_are_isolated(self):
        Invoice.objects.create(
            organization=self.other_org, student=self.theirs, amount=Decimal("100"),
            issued_on=date(2026, 1, 1), due_on=date(2026, 1, 10),
        )
        response = self.client_for(self.owner).get("/api/billing/invoices/")
        self.assertEqual(response.data["count"], 0)

    def test_billing_summary_counts_only_this_organization(self):
        Invoice.objects.create(
            organization=self.other_org, student=self.theirs, amount=Decimal("5000"),
            issued_on=date(2026, 1, 1), due_on=date(2026, 1, 10),
        )
        response = self.client_for(self.owner).get("/api/billing/summary/")
        self.assertEqual(Decimal(response.data["billed"]), Decimal("0"))


class WriteIsolationTests(TenantAPITestCase):
    """Reads being filtered is not enough — a foreign id passed into a write
    must be refused, or one academy can attach records to another's rows."""

    def setUp(self):
        super().setUp()
        self.their_student = Student.objects.create(
            organization=self.other_org, full_name="Their Student", joined_on=date(2026, 1, 1)
        )

    def test_cannot_invoice_another_organizations_student(self):
        response = self.client_for(self.owner).post(
            "/api/billing/invoices/",
            {
                "student": self.their_student.id, "amount": "500.00",
                "issued_on": "2026-01-01", "due_on": "2026-01-10",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("student", response.data)

    def test_cannot_enrol_another_organizations_student(self):
        batch = self.client_for(self.owner).post(
            "/api/batches/", {"name": "Morning", "days_of_week": [0]}, format="json"
        ).data
        response = self.client_for(self.owner).post(
            "/api/batches/enrolments/",
            {"batch": batch["id"], "student": self.their_student.id,
             "enrolled_on": "2026-01-01"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_cannot_mark_attendance_for_another_organizations_student(self):
        batch = self.client_for(self.owner).post(
            "/api/batches/", {"name": "Morning", "days_of_week": [0]}, format="json"
        ).data
        response = self.client_for(self.owner).post(
            "/api/attendance/mark/",
            {"batch": batch["id"], "date": "2026-01-05",
             "marks": [{"student": self.their_student.id, "status": "present"}]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_custom_exercises_do_not_leak_between_organizations(self):
        shared = Exercise.objects.create(
            name="Bench Press", slug="bench-press", primary_muscle="chest"
        )
        theirs = Exercise.objects.create(
            organization=self.other_org, name="Their Move", slug="their-move",
            primary_muscle="chest",
        )

        response = self.client_for(self.owner).get("/api/gym/exercises/")
        ids = [row["id"] for row in response.data["results"]]
        self.assertIn(shared.id, ids, "the shared library should be visible")
        self.assertNotIn(theirs.id, ids, "another academy's custom exercise must not be")

    def test_cannot_build_a_routine_from_another_organizations_exercise(self):
        theirs = Exercise.objects.create(
            organization=self.other_org, name="Their Move", slug="their-move",
            primary_muscle="chest",
        )
        response = self.client_for(self.owner).post(
            "/api/gym/routines/",
            {"name": "Sneaky", "items": [{"exercise_id": theirs.id, "target_sets": 3,
                                          "target_reps": 5}]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)


class PersonalDataIsolationTests(TenantAPITestCase):
    """Body measurements and food logs belong to one person, not to the
    academy. Even the owner must not see another person's."""

    def test_measurements_are_private_to_their_owner(self):
        self.client_for(self.manager).post(
            "/api/gym/body/entries/",
            {"metric": "weight", "value": "80", "measured_on": "2026-01-01"},
            format="json",
        )
        owner_view = self.client_for(self.owner).get("/api/gym/body/entries/?metric=weight")
        self.assertEqual(owner_view.data["count"], 0)

        own_view = self.client_for(self.manager).get("/api/gym/body/entries/?metric=weight")
        self.assertEqual(own_view.data["count"], 1)

    def test_food_log_is_private_to_its_owner(self):
        from nutrition.models import Food

        food = Food.objects.create(
            name="Rice", slug="rice", energy_kcal=130, protein_g=2.7, carbs_g=28, fat_g=0.3
        )
        self.client_for(self.manager).post(
            "/api/gym/nutrition/log/",
            {"food_id": food.id, "amount_g": "100", "meal": "lunch",
             "consumed_on": "2026-01-01"},
            format="json",
        )
        owner_view = self.client_for(self.owner).get(
            "/api/gym/nutrition/log/?date=2026-01-01"
        )
        self.assertEqual(owner_view.data["count"], 0)
