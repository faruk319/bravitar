"""Give every workout row a member to belong to."""

from django.db import migrations


APP = "workouts"
OWNED = [("routine", "student"), ("workoutsession", "student")]


def spread_across_members(apps, schema_editor):
    """Give every orphaned row a member to belong to.

    These were keyed to a login. Most members have none, which is the whole
    reason for the change, so there is nothing to match on — a demo row is
    handed to a member of its own academy, and a real one to nobody.
    """
    Student = apps.get_model("students", "Student")
    for model_name, _ in OWNED:
        model = apps.get_model(APP, model_name)
        by_academy = {}
        for row in model.objects.all():
            members = by_academy.get(row.academy_id)
            if members is None:
                members = list(
                    Student.objects.filter(academy_id=row.academy_id).order_by("id")
                )
                by_academy[row.academy_id] = members
            if not members:
                row.delete()
                continue
            row.student_id = members[row.pk % len(members)].id
            row.save(update_fields=["student_id"])


def unspread(apps, schema_editor):
    """Nothing to undo — user_id is restored empty by the reverse AddField."""


class Migration(migrations.Migration):

    dependencies = [
        ("workouts", "0005_remove_routine_user_id_remove_workoutsession_user_id_and_more"),
        ("students", "0007_student_invited_at"),
    ]

    operations = [
        migrations.RunPython(spread_across_members, unspread),
    ]
