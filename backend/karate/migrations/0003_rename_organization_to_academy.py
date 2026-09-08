from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('karate', '0002_alter_grading_options_alter_gradingresult_options'), ('organizations', '0009_rename_organization_to_academy')]

    operations = [
        migrations.RemoveConstraint(model_name='belt', name='unique_belt_name_per_org'),
        migrations.RenameField(model_name='belt', old_name='organization', new_name='academy'),
        migrations.RenameField(model_name='bout', old_name='organization', new_name='academy'),
        migrations.RenameField(model_name='grading', old_name='organization', new_name='academy'),
        migrations.AddConstraint(model_name='belt', constraint=models.UniqueConstraint(fields=['academy', 'name'], name='unique_belt_name_per_org')),
    ]
