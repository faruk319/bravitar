from decimal import Decimal

from django.db import models
from django.utils import timezone

from organizations.models import Organization
from students.models import Student

from .constants import BillingCycle, InvoiceStatus, PaymentMethod


class FeePlan(models.Model):
    """A named fee, e.g. "Monthly gym membership — 1500"."""

    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="fee_plans")
    name = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    cycle = models.CharField(max_length=20, choices=BillingCycle.CHOICES, default=BillingCycle.MONTHLY)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.amount})"


class Invoice(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="invoices")
    student = models.ForeignKey(Student, on_delete=models.PROTECT, related_name="invoices")
    fee_plan = models.ForeignKey(
        FeePlan, on_delete=models.SET_NULL, related_name="invoices", null=True, blank=True
    )

    description = models.CharField(max_length=255, blank=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    issued_on = models.DateField()
    due_on = models.DateField()
    period_start = models.DateField(null=True, blank=True)
    period_end = models.DateField(null=True, blank=True)
    is_cancelled = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-issued_on", "-id"]

    def __str__(self):
        return f"{self.student.full_name} — {self.amount} due {self.due_on}"

    @property
    def amount_paid(self):
        total = self.payments.aggregate(total=models.Sum("amount"))["total"]
        return (total or Decimal("0")).quantize(Decimal("0.01"))

    @property
    def balance(self):
        return (self.amount - self.amount_paid).quantize(Decimal("0.01"))

    @property
    def status(self):
        if self.is_cancelled:
            return InvoiceStatus.CANCELLED
        paid = self.amount_paid
        if paid >= self.amount:
            return InvoiceStatus.PAID
        if self.due_on < timezone.localdate():
            return InvoiceStatus.OVERDUE
        if paid > 0:
            return InvoiceStatus.PARTIAL
        return InvoiceStatus.UNPAID


class Payment(models.Model):
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="payments")
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    paid_on = models.DateField()
    method = models.CharField(max_length=20, choices=PaymentMethod.CHOICES, default=PaymentMethod.CASH)
    reference = models.CharField(max_length=255, blank=True)
    recorded_by = models.CharField(max_length=64, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-paid_on", "-id"]

    def __str__(self):
        return f"{self.amount} on {self.paid_on}"
