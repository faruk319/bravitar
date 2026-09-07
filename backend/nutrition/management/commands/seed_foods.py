from django.core.management.base import BaseCommand
from django.utils.text import slugify

from nutrition.models import Food
from nutrition.seed_data import SHARED_FOODS


class Command(BaseCommand):
    help = "Seeds (or updates) the shared food library. Safe to re-run."

    def handle(self, *args, **options):
        created = updated = 0

        for name, kcal, protein, carbs, fat, fiber, serving_g, serving_label in SHARED_FOODS:
            _, was_created = Food.objects.update_or_create(
                organization=None,
                slug=slugify(name),
                defaults={
                    "name": name,
                    "energy_kcal": kcal,
                    "protein_g": protein,
                    "carbs_g": carbs,
                    "fat_g": fat,
                    "fiber_g": fiber,
                    "serving_size_g": serving_g,
                    "serving_label": serving_label,
                },
            )
            if was_created:
                created += 1
            else:
                updated += 1

        self.stdout.write(
            self.style.SUCCESS(f"Shared foods: {created} created, {updated} updated.")
        )
