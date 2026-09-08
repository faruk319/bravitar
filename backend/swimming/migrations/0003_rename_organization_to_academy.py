from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('swimming', '0002_alter_skillassessment_options'), ('organizations', '0009_rename_organization_to_academy')]

    operations = [
        migrations.RenameField(model_name='lanebooking', old_name='organization', new_name='academy'),
        migrations.RenameField(model_name='pool', old_name='organization', new_name='academy'),
        migrations.RenameField(model_name='swimlevel', old_name='organization', new_name='academy'),
    ]
