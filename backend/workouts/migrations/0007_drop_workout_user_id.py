"""Drop the old owner column.

Separate from 0005 on purpose: that one rewrites every row to point at a
member, and Postgres will not ALTER a table with those writes still pending
in the same transaction.
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("workouts", "0006_point_workouts_at_members"),
    ]

    operations = [
        migrations.RemoveField(
            model_name='routine',
            name='user_id',
        ),
        migrations.RemoveField(
            model_name='workoutsession',
            name='user_id',
        ),
    ]
