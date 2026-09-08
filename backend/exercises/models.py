from django.db import models

from organizations.models import Academy

from .constants import Category, Equipment, Muscle


class ExerciseQuerySet(models.QuerySet):
    def visible_to(self, academy):
        """The shared library plus this academy's own custom exercises."""
        return self.filter(
            models.Q(academy__isnull=True) | models.Q(academy=academy)
        )


class Exercise(models.Model):
    """An exercise, either from the shared library (academy is null) or
    added by one academy for its own use."""

    academy = models.ForeignKey(
        Academy,
        on_delete=models.CASCADE,
        related_name="exercises",
        null=True,
        blank=True,
        help_text="Null means this is a shared library exercise, visible to everyone.",
    )

    name = models.CharField(max_length=255)
    slug = models.SlugField(max_length=255)
    category = models.CharField(max_length=20, choices=Category.CHOICES, default=Category.STRENGTH)
    equipment = models.CharField(max_length=20, choices=Equipment.CHOICES, default=Equipment.OTHER)
    primary_muscle = models.CharField(max_length=20, choices=Muscle.CHOICES)
    secondary_muscles = models.JSONField(default=list, blank=True)
    instructions = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = ExerciseQuerySet.as_manager()

    class Meta:
        ordering = ["name"]
        constraints = [
            # Postgres treats NULLs as distinct, so the shared library needs
            # its own constraint rather than relying on (academy, slug).
            models.UniqueConstraint(
                fields=["slug"],
                condition=models.Q(academy__isnull=True),
                name="unique_shared_exercise_slug",
            ),
            models.UniqueConstraint(
                fields=["academy", "slug"],
                name="unique_org_exercise_slug",
            ),
        ]

    def __str__(self):
        return self.name

    @property
    def is_custom(self):
        return self.academy_id is not None
