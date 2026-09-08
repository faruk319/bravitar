from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('exercises', '0001_initial'), ('organizations', '0009_rename_organization_to_academy')]

    operations = [
        migrations.RemoveConstraint(model_name='exercise', name='unique_org_exercise_slug'),
        migrations.RenameField(model_name='exercise', old_name='organization', new_name='academy'),
        migrations.AddConstraint(model_name='exercise', constraint=models.UniqueConstraint(fields=['academy', 'slug'], name='unique_org_exercise_slug')),
    ]
