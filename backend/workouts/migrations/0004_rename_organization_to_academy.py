from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('workouts', '0003_backfill_estimated_1rm'), ('organizations', '0009_rename_organization_to_academy')]

    operations = [
        migrations.RenameField(model_name='routine', old_name='organization', new_name='academy'),
        migrations.RenameField(model_name='workoutsession', old_name='organization', new_name='academy'),
    ]
