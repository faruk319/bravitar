"""Personal trainers, and what they earn.

Commission is counted on money that has actually arrived, not on what was
invoiced. A cut of a bill nobody has paid is a promise, not earnings — the
same reason a membership stays pending until somebody pays for it.
"""

from decimal import Decimal

from django.db import models

from organizations.models import Academy, Membership
from students.models import Student


class TrainerAssignment(models.Model):
    """One trainer looking after one member.

    Only offered on a plan that includes a personal trainer — assigning one
    otherwise would promise something nobody sold.
    """

    BRANCH_FIELD = "student__branch"

    academy = models.ForeignKey(
        Academy, on_delete=models.CASCADE, related_name="trainer_assignments"
    )
    trainer = models.ForeignKey(
        Membership, on_delete=models.CASCADE, related_name="clients"
    )
    student = models.ForeignKey(
        Student, on_delete=models.CASCADE, related_name="trainer_assignments"
    )

    started_on = models.DateField()
    ended_on = models.DateField(null=True, blank=True)
    # What this trainer earns on what this member pays. Per assignment, not
    # per trainer: a senior trainer taking on a difficult client is a
    # negotiation, not a global setting.
    commission_percent = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal("0.00")
    )
    notes = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-started_on", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["student"],
                condition=models.Q(ended_on__isnull=True),
                name="one_running_trainer_per_member",
            )
        ]

    def __str__(self):
        return f"{self.trainer.email} trains {self.student.full_name}"

    @property
    def is_running(self):
        return self.ended_on is None

    def earned_between(self, start, end):
        """Their cut of what this member actually paid in the window."""
        from billing.models import Payment

        paid = Payment.objects.filter(
            invoice__student=self.student,
            invoice__is_cancelled=False,
            paid_on__range=(start, end),
        ).aggregate(total=models.Sum("amount"))["total"] or Decimal("0")

        # Only what they paid while this trainer had them.
        if self.started_on > end or (self.ended_on and self.ended_on < start):
            return Decimal("0.00")
        return (paid * self.commission_percent / 100).quantize(Decimal("0.01"))
