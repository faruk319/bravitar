from decimal import Decimal

from django.db import models

from organizations.models import Academy

from .constants import Meal


class FoodQuerySet(models.QuerySet):
    def visible_to(self, academy):
        """The shared food library plus this academy's own entries."""
        return self.filter(
            models.Q(academy__isnull=True) | models.Q(academy=academy)
        )


class Food(models.Model):
    """A food, with macros stored per 100 g so portions are a simple scale.

    Same shape as Exercise: academy null means it's in the shared library.
    """

    academy = models.ForeignKey(
        Academy, on_delete=models.CASCADE, related_name="foods",
        null=True, blank=True,
        help_text="Null means this is a shared library food.",
    )

    name = models.CharField(max_length=255)
    slug = models.SlugField(max_length=255)
    brand = models.CharField(max_length=255, blank=True)

    energy_kcal = models.DecimalField(max_digits=6, decimal_places=1)
    protein_g = models.DecimalField(max_digits=5, decimal_places=1)
    carbs_g = models.DecimalField(max_digits=5, decimal_places=1)
    fat_g = models.DecimalField(max_digits=5, decimal_places=1)
    fiber_g = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)

    serving_size_g = models.DecimalField(
        max_digits=6, decimal_places=1, null=True, blank=True,
        help_text="Grams in one natural serving, e.g. one medium banana.",
    )
    serving_label = models.CharField(max_length=100, blank=True)
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)

    objects = FoodQuerySet.as_manager()

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["slug"],
                condition=models.Q(academy__isnull=True),
                name="unique_shared_food_slug",
            ),
            models.UniqueConstraint(
                fields=["academy", "slug"], name="unique_org_food_slug"
            ),
        ]

    def __str__(self):
        return f"{self.brand} {self.name}".strip()

    @property
    def is_custom(self):
        return self.academy_id is not None


class NutritionPlan(models.Model):
    """One lifter's daily macro targets. One active plan per person per org."""

    academy = models.ForeignKey(
        Academy, on_delete=models.CASCADE, related_name="nutrition_plans"
    )
    student = models.ForeignKey(
        "students.Student", on_delete=models.CASCADE, related_name="nutrition_plans", null=True,
    )

    name = models.CharField(max_length=255, default="Daily targets")
    target_kcal = models.PositiveIntegerField()
    target_protein_g = models.PositiveSmallIntegerField()
    target_carbs_g = models.PositiveSmallIntegerField()
    target_fat_g = models.PositiveSmallIntegerField()

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["academy", "student"], name="one_nutrition_plan_per_member"
            )
        ]

    def __str__(self):
        return f"{self.name} ({self.target_kcal} kcal)"


class FoodLogEntry(models.Model):
    """Something eaten, on a day, in a meal."""

    academy = models.ForeignKey(
        Academy, on_delete=models.CASCADE, related_name="food_log"
    )
    student = models.ForeignKey(
        "students.Student", on_delete=models.CASCADE, related_name="food_log", null=True,
    )

    food = models.ForeignKey(Food, on_delete=models.PROTECT, related_name="log_entries")
    amount_g = models.DecimalField(max_digits=7, decimal_places=1)
    meal = models.CharField(max_length=20, choices=Meal.CHOICES, default=Meal.SNACK)
    consumed_on = models.DateField()

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["consumed_on", "id"]

    def __str__(self):
        return f"{self.amount_g}g {self.food.name} on {self.consumed_on}"

    def _scaled(self, per_100g):
        """Macros are stored per 100 g, so a portion is just a ratio."""
        if per_100g is None:
            return None
        return (Decimal(per_100g) * self.amount_g / Decimal(100)).quantize(Decimal("0.1"))

    @property
    def energy_kcal(self):
        return self._scaled(self.food.energy_kcal)

    @property
    def protein_g(self):
        return self._scaled(self.food.protein_g)

    @property
    def carbs_g(self):
        return self._scaled(self.food.carbs_g)

    @property
    def fat_g(self):
        return self._scaled(self.food.fat_g)
