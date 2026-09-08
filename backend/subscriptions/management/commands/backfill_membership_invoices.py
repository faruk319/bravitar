"""Raises the missing invoice for memberships sold before billing was linked.

Deliberately a command rather than a data migration: it creates financial
records, and that should be something someone chooses to run after looking at
what it will do — not something that happens silently on deploy.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from organizations.models import Academy
from subscriptions.models import MemberSubscription


class Command(BaseCommand):
    help = "Creates invoices for memberships that don't have one yet."

    def add_arguments(self, parser):
        parser.add_argument("--slug", help="Limit to one academy.")
        parser.add_argument(
            "--dry-run", action="store_true",
            help="Show what would be billed without writing anything.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        missing = MemberSubscription.objects.filter(
            invoice__isnull=True
        ).select_related("student", "tier", "academy")

        if options["slug"]:
            try:
                org = Academy.objects.get(slug=options["slug"])
            except Academy.DoesNotExist:
                self.stderr.write(f"No academy with slug '{options['slug']}'.")
                return
            missing = missing.filter(academy=org)

        total = 0
        for subscription in missing:
            total += subscription.price_paid
            if not options["dry_run"]:
                subscription.raise_invoice()

        verb = "would raise" if options["dry_run"] else "raised"
        self.stdout.write(self.style.SUCCESS(
            f"{verb} {missing.count()} invoice(s) worth {total}."
        ))
        if options["dry_run"]:
            transaction.set_rollback(True)
