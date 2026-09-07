from django.core.management.base import BaseCommand
from django.utils.text import slugify

from exercises.models import Exercise
from exercises.seed_data import SHARED_EXERCISES


class Command(BaseCommand):
    help = "Seeds (or updates) the shared exercise library. Safe to re-run."

    def handle(self, *args, **options):
        created = updated = 0

        for name, category, equipment, primary, secondary in SHARED_EXERCISES:
            _, was_created = Exercise.objects.update_or_create(
                organization=None,
                slug=slugify(name),
                defaults={
                    "name": name,
                    "category": category,
                    "equipment": equipment,
                    "primary_muscle": primary,
                    "secondary_muscles": secondary,
                },
            )
            if was_created:
                created += 1
            else:
                updated += 1

        self.stdout.write(
            self.style.SUCCESS(f"Shared exercises: {created} created, {updated} updated.")
        )
