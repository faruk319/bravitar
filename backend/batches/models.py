from django.db import models

from organizations.models import Academy, Branch
from students.models import Student


class Batch(models.Model):
    """A recurring class or training group. Generic across verticals — a swim
    lane, a karate belt group and a gym slot are all batches."""

    BRANCH_FIELD = "branch"

    academy = models.ForeignKey(Academy, on_delete=models.CASCADE, related_name="batches")
    branch = models.ForeignKey(
        Branch, on_delete=models.SET_NULL, related_name="batches", null=True, blank=True
    )

    name = models.CharField(max_length=255)
    description = models.CharField(max_length=500, blank=True)
    coach_name = models.CharField(max_length=255, blank=True)

    # 0 = Monday .. 6 = Sunday, matching Python's weekday().
    days_of_week = models.JSONField(default=list, blank=True)
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    capacity = models.PositiveSmallIntegerField(null=True, blank=True)

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "batches"

    def __str__(self):
        return self.name

    @property
    def enrolled_count(self):
        return self.enrolments.filter(is_active=True).count()


class Enrolment(models.Model):
    """Links a student to a batch. Kept as its own row rather than a
    many-to-many so leaving a batch is recorded, not erased."""

    BRANCH_FIELD = "batch__branch"

    batch = models.ForeignKey(Batch, on_delete=models.CASCADE, related_name="enrolments")
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="enrolments")

    enrolled_on = models.DateField()
    left_on = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["-enrolled_on", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["batch", "student"],
                condition=models.Q(is_active=True),
                name="one_active_enrolment_per_student_per_batch",
            )
        ]

    def __str__(self):
        return f"{self.student.full_name} in {self.batch.name}"
