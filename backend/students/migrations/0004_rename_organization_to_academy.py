from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('students', '0003_student_qr_token'), ('organizations', '0009_rename_organization_to_academy')]

    operations = [
        migrations.RenameField(model_name='memberdocument', old_name='organization', new_name='academy'),
        migrations.RenameField(model_name='student', old_name='organization', new_name='academy'),
    ]
