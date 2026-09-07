"""Domain rules where being wrong costs money, or misrecords something a
person will act on."""

from datetime import date
from decimal import Decimal

from billing.constants import InvoiceStatus
from billing.models import Invoice
from students.models import Student

from .base import TenantAPITestCase


class BillingTests(TenantAPITestCase):
    def setUp(self):
        super().setUp()
        self.student = Student.objects.create(
            organization=self.org, full_name="Payer", joined_on=date(2026, 1, 1)
        )
        self.invoice = Invoice.objects.create(
            organization=self.org, student=self.student, amount=Decimal("1000.00"),
            issued_on=date(2026, 1, 1), due_on=date(2999, 1, 1),
        )

    def pay(self, amount):
        return self.client_for(self.owner).post(
            "/api/billing/payments/",
            {"invoice": self.invoice.id, "amount": amount, "paid_on": "2026-01-02"},
            format="json",
        )

    def test_status_is_derived_from_payments(self):
        self.assertEqual(self.invoice.status, InvoiceStatus.UNPAID)
        self.pay("400.00")
        self.assertEqual(self.invoice.status, InvoiceStatus.PARTIAL)
        self.pay("600.00")
        self.assertEqual(self.invoice.status, InvoiceStatus.PAID)

    def test_overpayment_is_refused(self):
        self.assertEqual(self.pay("600.00").status_code, 201)
        response = self.pay("600.00")
        self.assertEqual(response.status_code, 400)
        self.assertIn("400.00", str(response.data["amount"]))
        self.assertEqual(self.invoice.amount_paid, Decimal("600.00"))

    def test_balance_never_goes_negative(self):
        self.pay("1000.00")
        self.assertEqual(self.invoice.balance, Decimal("0.00"))
        self.assertEqual(self.pay("0.01").status_code, 400)

    def test_overdue_is_derived_from_the_due_date(self):
        overdue = Invoice.objects.create(
            organization=self.org, student=self.student, amount=Decimal("100.00"),
            issued_on=date(2020, 1, 1), due_on=date(2020, 1, 10),
        )
        self.assertEqual(overdue.status, InvoiceStatus.OVERDUE)

    def test_summary_balances(self):
        self.pay("400.00")
        response = self.client_for(self.owner).get("/api/billing/summary/")
        billed = Decimal(response.data["billed"])
        collected = Decimal(response.data["collected"])
        outstanding = Decimal(response.data["outstanding"])
        self.assertEqual(billed - collected, outstanding)


class AttendanceTests(TenantAPITestCase):
    def setUp(self):
        super().setUp()
        self.student = Student.objects.create(
            organization=self.org, full_name="Attendee", joined_on=date(2026, 1, 1)
        )
        self.batch = self.client_for(self.owner).post(
            "/api/batches/", {"name": "Morning", "days_of_week": [0]}, format="json"
        ).data

    def mark(self, status):
        return self.client_for(self.staff).post(
            "/api/attendance/mark/",
            {"batch": self.batch["id"], "date": "2026-01-05",
             "marks": [{"student": self.student.id, "status": status}]},
            format="json",
        )

    def test_remarking_corrects_rather_than_duplicating(self):
        self.mark("absent")
        self.mark("present")

        response = self.client_for(self.owner).get(
            f"/api/attendance/?batch={self.batch['id']}&date=2026-01-05"
        )
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["status"], "present")

    def test_attendance_rate_counts_late_as_attended(self):
        self.mark("late")
        response = self.client_for(self.owner).get(
            f"/api/attendance/summary/?batch={self.batch['id']}"
        )
        row = response.data["students"][0]
        self.assertEqual(row["attended"], 1)
        self.assertEqual(row["rate"], 1.0)

    def test_unknown_status_is_refused(self):
        self.assertEqual(self.mark("teleported").status_code, 400)


class BatchCapacityTests(TenantAPITestCase):
    def test_a_full_batch_refuses_another_enrolment(self):
        batch = self.client_for(self.owner).post(
            "/api/batches/", {"name": "Tiny", "days_of_week": [0], "capacity": 1},
            format="json",
        ).data

        first, second = [
            Student.objects.create(
                organization=self.org, full_name=name, joined_on=date(2026, 1, 1)
            )
            for name in ("First", "Second")
        ]

        ok = self.client_for(self.owner).post(
            "/api/batches/enrolments/",
            {"batch": batch["id"], "student": first.id, "enrolled_on": "2026-01-01"},
            format="json",
        )
        self.assertEqual(ok.status_code, 201)

        full = self.client_for(self.owner).post(
            "/api/batches/enrolments/",
            {"batch": batch["id"], "student": second.id, "enrolled_on": "2026-01-01"},
            format="json",
        )
        self.assertEqual(full.status_code, 400)
        self.assertIn("full", str(full.data))
