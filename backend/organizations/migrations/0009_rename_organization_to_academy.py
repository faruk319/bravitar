from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('organizations', '0008_branch_email_branch_phone_and_more'),
        ('attendance', '0006_biometricenrolment'),
        ('batches', '0003_alter_enrolment_options'),
        ('billing', '0002_initial'),
        ('bodylog', '0001_initial'),
        ('enquiries', '0003_alter_enquiry_options'),
        ('exercises', '0001_initial'),
        ('karate', '0002_alter_grading_options_alter_gradingresult_options'),
        ('nutrition', '0001_initial'),
        ('students', '0003_student_qr_token'),
        ('subscriptions', '0001_initial'),
        ('swimming', '0002_alter_skillassessment_options'),
        ('workouts', '0003_backfill_estimated_1rm'),
    ]

    operations = [
        migrations.RenameModel(old_name='Organization', new_name='Academy'),
        migrations.RemoveConstraint(model_name='branch', name='one_primary_branch_per_org'),
        migrations.RemoveConstraint(model_name='membership', name='one_membership_per_user_per_org'),
        migrations.RemoveConstraint(model_name='membership', name='one_membership_per_email_per_org'),
        migrations.RenameField(model_name='apikey', old_name='organization', new_name='academy'),
        migrations.RenameField(model_name='branch', old_name='organization', new_name='academy'),
        migrations.RenameField(model_name='membership', old_name='organization', new_name='academy'),
        migrations.AddConstraint(model_name='branch', constraint=models.UniqueConstraint(fields=['academy'], name='one_primary_branch_per_org', condition=models.Q(('is_primary', True)))),
        migrations.AddConstraint(model_name='membership', constraint=models.UniqueConstraint(fields=['academy', 'user_id'], name='one_membership_per_user_per_org', condition=models.Q(('user_id', ''), _negated=True))),
        migrations.AddConstraint(model_name='membership', constraint=models.UniqueConstraint(fields=['academy', 'email'], name='one_membership_per_email_per_org', condition=models.Q(('email', ''), _negated=True))),
    ]
