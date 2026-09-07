from django.db import models

from exercises.models import Exercise
from organizations.models import Organization


class Routine(models.Model):
    """A reusable workout plan — created by a trainer for a member, or by a
    member for themselves."""

    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="routines")
    user_id = models.CharField(max_length=64, help_text="Supabase user id of the owner.")
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    is_archived = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.name


class RoutineExercise(models.Model):
    """One exercise slot in a routine, with its targets."""

    routine = models.ForeignKey(Routine, on_delete=models.CASCADE, related_name="items")
    exercise = models.ForeignKey(Exercise, on_delete=models.PROTECT, related_name="routine_items")
    position = models.PositiveIntegerField(default=0)

    target_sets = models.PositiveSmallIntegerField(default=3)
    target_reps = models.PositiveSmallIntegerField(default=10)
    target_weight = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    rest_seconds = models.PositiveSmallIntegerField(null=True, blank=True)
    notes = models.CharField(max_length=500, blank=True)

    class Meta:
        ordering = ["position", "id"]

    def __str__(self):
        return f"{self.exercise.name} in {self.routine.name}"


class WorkoutSession(models.Model):
    """One actual training session. May follow a routine, or be freestyle."""

    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="sessions")
    user_id = models.CharField(max_length=64)
    routine = models.ForeignKey(
        Routine, on_delete=models.SET_NULL, related_name="sessions", null=True, blank=True
    )

    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-started_at"]

    def __str__(self):
        return f"{self.routine.name if self.routine else 'Freestyle'} — {self.started_at:%Y-%m-%d}"


class SetLog(models.Model):
    """A single logged set. The grain the whole progress story is built on."""

    session = models.ForeignKey(WorkoutSession, on_delete=models.CASCADE, related_name="sets")
    exercise = models.ForeignKey(Exercise, on_delete=models.PROTECT, related_name="set_logs")

    set_number = models.PositiveSmallIntegerField(default=1)
    reps = models.PositiveSmallIntegerField()
    weight = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    logged_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"{self.exercise.name} {self.reps}x{self.weight or 'BW'}"
