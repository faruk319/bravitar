from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('attendance', '0006_biometricenrolment'), ('organizations', '0009_rename_organization_to_academy')]

    operations = [
        migrations.RemoveConstraint(model_name='biometricenrolment', name='one_member_per_reader_id'),
        migrations.RenameField(model_name='attendancerecord', old_name='organization', new_name='academy'),
        migrations.RenameField(model_name='biometricenrolment', old_name='organization', new_name='academy'),
        migrations.RenameField(model_name='checkin', old_name='organization', new_name='academy'),
        migrations.AddConstraint(model_name='biometricenrolment', constraint=models.UniqueConstraint(fields=['academy', 'device', 'external_id'], name='one_member_per_reader_id')),
    ]
