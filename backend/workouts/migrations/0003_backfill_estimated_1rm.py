from decimal import Decimal

from django.db import migrations


def backfill(apps, schema_editor):
    """Sets logged before estimated_1rm existed would otherwise never count
    toward a personal record, making the next set look like a false PR."""
    SetLog = apps.get_model("workouts", "SetLog")

    to_update = []
    for set_log in SetLog.objects.filter(estimated_1rm__isnull=True, weight__isnull=False):
        if not set_log.reps:
            continue
        set_log.estimated_1rm = (
            Decimal(set_log.weight) * (1 + Decimal(set_log.reps) / Decimal(30))
        ).quantize(Decimal("0.01"))
        to_update.append(set_log)

    SetLog.objects.bulk_update(to_update, ["estimated_1rm"], batch_size=500)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("workouts", "0002_routine_progression_routine_progression_increment_and_more"),
    ]

    operations = [migrations.RunPython(backfill, noop)]
