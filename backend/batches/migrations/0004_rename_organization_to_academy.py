from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('batches', '0003_alter_enrolment_options'), ('organizations', '0009_rename_organization_to_academy')]

    operations = [
        migrations.RenameField(model_name='batch', old_name='organization', new_name='academy'),
    ]
