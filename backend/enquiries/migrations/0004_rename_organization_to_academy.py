from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('enquiries', '0003_alter_enquiry_options'), ('organizations', '0009_rename_organization_to_academy')]

    operations = [
        migrations.RenameField(model_name='enquiry', old_name='organization', new_name='academy'),
    ]
