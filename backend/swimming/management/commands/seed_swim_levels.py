from django.core.management.base import BaseCommand, CommandError

from organizations.models import Academy
from swimming.models import SwimLevel, SwimSkill
from swimming.seed_data import SWIM_LADDER


class Command(BaseCommand):
    help = "Seeds the standard swim ladder for one academy. Safe to re-run."

    def add_arguments(self, parser):
        parser.add_argument("slug", help="Academy slug.")

    def handle(self, *args, **options):
        try:
            org = Academy.objects.get(slug=options["slug"])
        except Academy.DoesNotExist:
            raise CommandError(f"No academy with slug '{options['slug']}'.")

        levels = skills = 0
        for position, (name, description, skill_names) in enumerate(SWIM_LADDER):
            level, created = SwimLevel.objects.update_or_create(
                academy=org, name=name,
                defaults={"position": position, "description": description},
            )
            levels += 1 if created else 0
            for skill_position, skill_name in enumerate(skill_names):
                _, made = SwimSkill.objects.update_or_create(
                    level=level, name=skill_name, defaults={"position": skill_position},
                )
                skills += 1 if made else 0

        self.stdout.write(self.style.SUCCESS(
            f"Swim ladder for {org.name}: {len(SWIM_LADDER)} levels "
            f"({levels} new), {skills} new skills."))
