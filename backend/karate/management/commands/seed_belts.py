from django.core.management.base import BaseCommand, CommandError

from karate.constants import DEFAULT_BELTS
from karate.models import Belt
from organizations.models import Organization


class Command(BaseCommand):
    help = "Seeds the standard belt ladder for one organization. Safe to re-run."

    def add_arguments(self, parser):
        parser.add_argument("slug", help="Organization slug.")

    def handle(self, *args, **options):
        try:
            org = Organization.objects.get(slug=options["slug"])
        except Organization.DoesNotExist:
            raise CommandError(f"No organization with slug '{options['slug']}'.")

        created = 0
        for position, (name, colour) in enumerate(DEFAULT_BELTS):
            _, made = Belt.objects.update_or_create(
                organization=org, name=name,
                defaults={"position": position, "colour": colour},
            )
            created += 1 if made else 0

        self.stdout.write(self.style.SUCCESS(
            f"Belts for {org.name}: {len(DEFAULT_BELTS)} total, {created} new."))
