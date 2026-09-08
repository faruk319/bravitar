"""Personal trainers: who looks after whom, and what that earns.

The rule worth testing is that commission follows money received, not money
invoiced. Everything else here guards the one-trainer-at-a-time promise.
"""

from datetime import date, timedelta
from decimal import Decimal

from django.utils import timezone

from organizations.constants import Role
from organizations.models import Membership
from students.models import Student
from subscriptions.constants import BillingPeriod
from subscriptions.models import MembershipTier
from subscriptions.trainers import TrainerAssignment

from .base import TenantAPITestCase


class TrainerTestCase(TenantAPITestCase):
    def setUp(self):
        super().setUp()
        self.today = timezone.localdate()
        self.pt_tier = MembershipTier.objects.create(
            academy=self.org, name="Personal Training", period=BillingPeriod.MONTHLY,
            duration_days=30, price=Decimal("5000.00"), includes_personal_trainer=True,
        )
        self.plain_tier = MembershipTier.objects.create(
            academy=self.org, name="Gym Only", period=BillingPeriod.MONTHLY,
            duration_days=30, price=Decimal("1500.00"),
        )
        self.trainer = Membership.objects.get(
            organization=self.org.organization, email="staff@example.com"
        )

    def enrolled(self, name, tier=None):
        """A member on a plan, with the invoice it raised."""
        student = Student.objects.create(
            academy=self.org, full_name=name, joined_on=date(2026, 1, 1)
        )
        created = self.client_for(self.manager).post(
            "/api/gym-ops/subscriptions/",
            {
                "student": student.id,
                "tier": (tier or self.pt_tier).id,
                "started_on": str(self.today),
            },
            format="json",
        )
        student.invoice_id = self.client_for(self.manager).get(
            f"/api/gym-ops/subscriptions/{created.data['id']}/"
        ).data["invoice"]
        return student

    def pay(self, student, amount, on=None):
        return self.client_for(self.manager).post(
            "/api/billing/payments/",
            {
                "invoice": student.invoice_id,
                "amount": str(amount),
                "paid_on": str(on or self.today),
            },
            format="json",
        )

    def assign(self, student, commission="10.00", started_on=None, trainer=None):
        return self.client_for(self.manager).post(
            "/api/gym-ops/trainers/",
            {
                "trainer": (trainer or self.trainer).id,
                "student": student.id,
                "started_on": str(started_on or self.today),
                "commission_percent": commission,
            },
            format="json",
        )


class AssigningATrainerTests(TrainerTestCase):
    def test_a_member_on_a_pt_plan_can_be_given_a_trainer(self):
        response = self.assign(self.enrolled("Aarav"))
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data["is_running"])

    def test_a_plan_without_personal_training_is_refused(self):
        """Assigning one otherwise promises something nobody sold."""
        response = self.assign(self.enrolled("Aarav", tier=self.plain_tier))
        self.assertEqual(response.status_code, 400)
        self.assertIn("doesn't include a personal trainer", str(response.data))

    def test_a_member_with_no_membership_is_refused(self):
        student = Student.objects.create(
            academy=self.org, full_name="Walked In", joined_on=date(2026, 1, 1)
        )
        response = self.assign(student)
        self.assertEqual(response.status_code, 400)
        self.assertIn("no membership running", str(response.data))

    def test_a_member_cannot_have_two_trainers_at_once(self):
        student = self.enrolled("Aarav")
        self.assertEqual(self.assign(student).status_code, 201)
        second = self.assign(student)
        self.assertEqual(second.status_code, 400)
        self.assertIn("already has a trainer", str(second.data))

    def test_ending_one_frees_the_member_for_another(self):
        student = self.enrolled("Aarav")
        first = self.assign(student).data

        ended = self.client_for(self.manager).patch(
            f"/api/gym-ops/trainers/{first['id']}/",
            {"ended_on": str(self.today)},
            format="json",
        )
        self.assertEqual(ended.status_code, 200)
        self.assertFalse(ended.data["is_running"])
        self.assertEqual(self.assign(student).status_code, 201)

    def test_commission_must_be_a_percentage(self):
        response = self.assign(self.enrolled("Aarav"), commission="140.00")
        self.assertEqual(response.status_code, 400)

    def test_staff_cannot_assign_trainers(self):
        """Commercial terms sit with whoever handles the invoices."""
        student = self.enrolled("Aarav")
        response = self.client_for(self.staff).post(
            "/api/gym-ops/trainers/",
            {
                "trainer": self.trainer.id, "student": student.id,
                "started_on": str(self.today), "commission_percent": "10.00",
            },
            format="json",
        )
        self.assertIn(response.status_code, (403, 404))


class TrainerEarningsTests(TrainerTestCase):
    def earnings(self, **params):
        query = "&".join(f"{k}={v}" for k, v in params.items())
        return self.client_for(self.manager).get(
            f"/api/gym-ops/trainers/earnings/?{query}"
        ).data

    def month(self):
        start = self.today.replace(day=1)
        return {"from": str(start), "to": str(self.today)}

    def test_an_unpaid_invoice_earns_nothing(self):
        """A cut of a bill nobody has paid is a promise, not earnings."""
        self.assign(self.enrolled("Aarav"), commission="10.00")
        data = self.earnings(**self.month())
        self.assertEqual(Decimal(str(data["total"])), Decimal("0.00"))

    def test_a_payment_earns_the_commission(self):
        student = self.enrolled("Aarav")
        self.assign(student, commission="10.00")
        self.pay(student, "5000.00")

        data = self.earnings(**self.month())
        self.assertEqual(Decimal(str(data["total"])), Decimal("500.00"))
        self.assertEqual(data["trainers"][0]["clients"], 1)

    def test_a_part_payment_earns_a_cut_of_what_arrived(self):
        student = self.enrolled("Aarav")
        self.assign(student, commission="10.00")
        self.pay(student, "2000.00")
        self.assertEqual(
            Decimal(str(self.earnings(**self.month())["total"])), Decimal("200.00")
        )

    def test_money_paid_before_the_trainer_took_over_is_not_theirs(self):
        student = self.enrolled("Aarav")
        self.pay(student, "5000.00")
        self.assign(student, commission="10.00", started_on=self.today + timedelta(days=1))

        data = self.earnings(**self.month())
        self.assertEqual(Decimal(str(data["total"])), Decimal("0.00"))

    def test_two_trainers_are_reported_separately(self):
        first = self.enrolled("Aarav")
        second = self.enrolled("Diya")
        other_trainer = Membership.objects.create(
            organization=self.org.organization, user_id="coach-2",
            email="coach2@example.com", role=Role.STAFF,
        )
        self.assign(first, commission="10.00")
        self.assign(second, commission="20.00", trainer=other_trainer)
        self.pay(first, "5000.00")
        self.pay(second, "5000.00")

        rows = {r["trainer_email"]: Decimal(str(r["earned"]))
                for r in self.earnings(**self.month())["trainers"]}
        self.assertEqual(rows["staff@example.com"], Decimal("500.00"))
        self.assertEqual(rows["coach2@example.com"], Decimal("1000.00"))


class TrainerIsolationTests(TrainerTestCase):
    def test_another_academys_member_cannot_be_assigned(self):
        outsider = Student.objects.create(
            academy=self.other_org, full_name="Theirs", joined_on=date(2026, 1, 1)
        )
        self.assertEqual(self.assign(outsider).status_code, 400)

    def test_a_trainer_from_another_organization_is_refused(self):
        theirs = Membership.objects.get(
            organization=self.other_org.organization, email="owner2@example.com"
        )
        response = self.assign(self.enrolled("Aarav"), trainer=theirs)
        self.assertEqual(response.status_code, 400)
        self.assertIn("not on this team", str(response.data))

    def test_assignments_do_not_leak_across_academies(self):
        self.assign(self.enrolled("Aarav"))
        response = self.client_for(self.other_owner, academy=self.other_org).get(
            "/api/gym-ops/trainers/"
        )
        self.assertIn(response.status_code, (200, 403))
        if response.status_code == 200:
            self.assertEqual(response.data["count"], 0)


class BatchCoachTests(TrainerTestCase):
    """A batch's coach is somebody on the team, not a name typed in a box."""

    def create_batch(self, coach):
        return self.client_for(self.manager).post(
            "/api/batches/",
            {"name": "Morning HIIT", "coach": coach.id, "days_of_week": [0, 2, 4]},
            format="json",
        )

    def test_a_batch_can_name_a_coach_from_the_team(self):
        response = self.create_batch(self.trainer)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["coach_label"], "staff@example.com")

    def test_a_coach_from_another_organization_is_refused(self):
        theirs = Membership.objects.get(
            organization=self.other_org.organization, email="owner2@example.com"
        )
        response = self.create_batch(theirs)
        self.assertEqual(response.status_code, 400)

    def test_the_old_free_text_coach_still_shows(self):
        """Rows written before there was somebody to point at."""
        response = self.client_for(self.manager).post(
            "/api/batches/",
            {"name": "Evening Yoga", "coach_name": "Priya", "days_of_week": [1]},
            format="json",
        )
        self.assertEqual(response.data["coach_label"], "Priya")


class TrainerAssignmentModelTests(TrainerTestCase):
    def test_earnings_are_zero_once_the_assignment_has_ended(self):
        student = self.enrolled("Aarav")
        assignment = TrainerAssignment.objects.create(
            academy=self.org, trainer=self.trainer, student=student,
            started_on=self.today - timedelta(days=60),
            ended_on=self.today - timedelta(days=30),
            commission_percent=Decimal("10.00"),
        )
        self.pay(student, "5000.00")
        self.assertEqual(
            assignment.earned_between(self.today.replace(day=1), self.today),
            Decimal("0.00"),
        )
