from django.db import models

from batches.models import Batch
from organizations.models import Branch, Organization
from students.models import Student


class Pool(models.Model):
    BRANCH_FIELD = "branch"

    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="pools")
    branch = models.ForeignKey(
        Branch, on_delete=models.SET_NULL, related_name="pools", null=True, blank=True
    )
    name = models.CharField(max_length=255)
    lane_count = models.PositiveSmallIntegerField(default=6)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class LaneBooking(models.Model):
    """A lane held for a batch at a recurring time.

    The whole point of this model is that a lane can't be in two places at
    once — double-booking is the actual failure a swim school hits.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="lane_bookings"
    )
    pool = models.ForeignKey(Pool, on_delete=models.CASCADE, related_name="bookings")
    lane_number = models.PositiveSmallIntegerField()
    batch = models.ForeignKey(
        Batch, on_delete=models.CASCADE, related_name="lane_bookings", null=True, blank=True
    )

    day_of_week = models.PositiveSmallIntegerField(help_text="0 = Monday .. 6 = Sunday")
    start_time = models.TimeField()
    end_time = models.TimeField()
    note = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["day_of_week", "start_time", "lane_number"]

    def __str__(self):
        return f"{self.pool.name} lane {self.lane_number} — day {self.day_of_week}"

    def clashes_with(self, others):
        """Same pool, same lane, same day, overlapping times."""
        return [
            other for other in others
            if other.pk != self.pk
            and other.pool_id == self.pool_id
            and other.lane_number == self.lane_number
            and other.day_of_week == self.day_of_week
            and other.start_time < self.end_time
            and self.start_time < other.end_time
        ]


class SwimLevel(models.Model):
    """A rung on the swim-school ladder, e.g. "Level 2 — Front Crawl"."""

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="swim_levels"
    )
    name = models.CharField(max_length=255)
    position = models.PositiveSmallIntegerField(default=0)
    description = models.CharField(max_length=500, blank=True)

    class Meta:
        ordering = ["position", "id"]

    def __str__(self):
        return self.name


class SwimSkill(models.Model):
    """One assessable thing inside a level, e.g. "Float on back for 10s"."""

    level = models.ForeignKey(SwimLevel, on_delete=models.CASCADE, related_name="skills")
    name = models.CharField(max_length=255)
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]

    def __str__(self):
        return self.name


class SkillAssessment(models.Model):
    """A skill signed off for a swimmer. Absence of a row means not yet done —
    there is no "failed" state, because a skill is either achieved or still
    being worked on."""

    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="swim_assessments")
    skill = models.ForeignKey(SwimSkill, on_delete=models.CASCADE, related_name="assessments")
    achieved_on = models.DateField()
    assessed_by = models.CharField(max_length=64, blank=True)
    note = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-achieved_on", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["student", "skill"], name="one_assessment_per_skill_per_student"
            )
        ]

    def __str__(self):
        return f"{self.student.full_name} — {self.skill.name}"
