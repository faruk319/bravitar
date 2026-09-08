from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('bodylog', '0001_initial'), ('organizations', '0009_rename_organization_to_academy')]

    operations = [
        migrations.RemoveConstraint(model_name='measuremententry', name='one_reading_per_metric_per_day'),
        migrations.RenameField(model_name='measuremententry', old_name='organization', new_name='academy'),
        migrations.RenameField(model_name='progressphoto', old_name='organization', new_name='academy'),
        migrations.AddConstraint(model_name='measuremententry', constraint=models.UniqueConstraint(fields=['academy', 'user_id', 'metric', 'measured_on'], name='one_reading_per_metric_per_day')),
    ]
