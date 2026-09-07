from django.db import models

from organizations.models import Branch, Organization
from students.models import Student

from .constants import BoutResult, GradingResultChoice


class Belt(models.Model):
    """A rank. `position` is the ladder — a student's current belt is the
    highest position they have passed, so belts can be renamed or recoloured
    without rewriting anyone's history."""

    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="belts")
    name = models.CharField(max_length=100)
    position = models.PositiveSmallIntegerField(default=0)
    colour = models.CharField(max_length=9, blank=True)

    class Meta:
        ordering = ["position", "id"]
        constraints = [
            models.UniqueConstraint(fields=["organization", "name"], name="unique_belt_name_per_org")
        ]

    def __str__(self):
        return self.name


class Grading(models.Model):
    """A grading exam held on a date, testing for one belt."""

    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="gradings")
    branch = models.ForeignKey(
        Branch, on_delete=models.SET_NULL, related_name="gradings", null=True, blank=True
    )
    belt = models.ForeignKey(Belt, on_delete=models.PROTECT, related_name="gradings")

    held_on = models.DateField()
    examiner = models.CharField(max_length=255, blank=True)
    notes = models.CharField(max_length=500, blank=True)

    class Meta:
        ordering = ["-held_on", "-id"]

    def __str__(self):
        return f"{self.belt.name} grading on {self.held_on}"


class GradingResult(models.Model):
    grading = models.ForeignKey(Grading, on_delete=models.CASCADE, related_name="results")
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="grading_results")
    result = models.CharField(max_length=10, choices=GradingResultChoice.CHOICES)
    score = models.PositiveSmallIntegerField(null=True, blank=True)
    notes = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(
                fields=["grading", "student"], name="one_result_per_student_per_grading"
            )
        ]

    def __str__(self):
        return f"{self.student.full_name} {self.result} {self.grading.belt.name}"


class Bout(models.Model):
    """One sparring match. The opponent is free text because most bouts are
    against visitors from other dojos, who aren't students here."""

    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="bouts")
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="bouts")

    fought_on = models.DateField()
    opponent_name = models.CharField(max_length=255, blank=True)
    opponent_student = models.ForeignKey(
        Student, on_delete=models.SET_NULL, related_name="bouts_against",
        null=True, blank=True,
    )

    result = models.CharField(max_length=10, choices=BoutResult.CHOICES)
    points_for = models.PositiveSmallIntegerField(default=0)
    points_against = models.PositiveSmallIntegerField(default=0)
    event = models.CharField(max_length=255, blank=True)
    notes = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-fought_on", "-id"]

    def __str__(self):
        return f"{self.student.full_name} {self.result} on {self.fought_on}"
