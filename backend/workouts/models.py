from decimal import Decimal

from django.db import models

from exercises.models import Exercise
from organizations.models import Organization

from .constants import ProgressionRule


def estimate_one_rep_max(weight, reps):
    """Epley formula. Returns None for bodyweight sets, and the weight itself
    for a single, where the formula degenerates."""
    if weight is None or not reps:
        return None
    return (Decimal(weight) * (1 + Decimal(reps) / Decimal(30))).quantize(Decimal("0.01"))


class Routine(models.Model):
    """A reusable workout plan — created by a trainer for a member, or by a
    member for themselves."""

    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="routines")
    user_id = models.CharField(max_length=64, help_text="Supabase user id of the owner.")
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    is_archived = models.BooleanField(default=False)

    progression = models.CharField(
        max_length=30, choices=ProgressionRule.CHOICES, default=ProgressionRule.NONE
    )
    progression_increment = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal("2.50"),
        help_text="How much weight to add when the rule says to progress.",
    )

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
    target_reps_max = models.PositiveSmallIntegerField(
        null=True, blank=True,
        help_text="Top of the rep range. Double progression needs this; other rules ignore it.",
    )
    target_weight = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    rest_seconds = models.PositiveSmallIntegerField(null=True, blank=True)
    superset_group = models.PositiveSmallIntegerField(
        null=True, blank=True,
        help_text="Items sharing a group are performed back-to-back with no rest between them.",
    )
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

    is_warmup = models.BooleanField(
        default=False,
        help_text="Warm-ups are excluded from personal records and progression.",
    )
    rir = models.PositiveSmallIntegerField(
        null=True, blank=True, help_text="Reps in reserve — how many were left in the tank."
    )
    estimated_1rm = models.DecimalField(
        max_digits=7, decimal_places=2, null=True, blank=True, editable=False
    )
    is_personal_record = models.BooleanField(default=False, editable=False)

    logged_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"{self.exercise.name} {self.reps}x{self.weight or 'BW'}"

    def save(self, *args, **kwargs):
        self.estimated_1rm = estimate_one_rep_max(self.weight, self.reps)
        if self._state.adding:
            self.is_personal_record = self._beats_previous_best()
        super().save(*args, **kwargs)

    def _beats_previous_best(self):
        """A working set counts as a PR when its estimated 1RM beats every
        working set this lifter has logged for the exercise before."""
        if self.is_warmup or self.estimated_1rm is None:
            return False

        previous_best = (
            SetLog.objects.filter(
                exercise=self.exercise,
                is_warmup=False,
                session__user_id=self.session.user_id,
                session__organization=self.session.organization,
            )
            .exclude(pk=self.pk)
            .aggregate(best=models.Max("estimated_1rm"))["best"]
        )
        return previous_best is None or self.estimated_1rm > previous_best
