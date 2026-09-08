from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('billing', '0002_initial'), ('organizations', '0009_rename_organization_to_academy')]

    operations = [
        migrations.RenameField(model_name='feeplan', old_name='organization', new_name='academy'),
        migrations.RenameField(model_name='invoice', old_name='organization', new_name='academy'),
    ]
