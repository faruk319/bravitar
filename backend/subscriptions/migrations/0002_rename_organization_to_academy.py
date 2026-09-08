from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('subscriptions', '0001_initial'), ('organizations', '0009_rename_organization_to_academy')]

    operations = [
        migrations.RemoveConstraint(model_name='membershiptier', name='unique_tier_name_per_org'),
        migrations.RenameField(model_name='membersubscription', old_name='organization', new_name='academy'),
        migrations.RenameField(model_name='membershiptier', old_name='organization', new_name='academy'),
        migrations.AddConstraint(model_name='membershiptier', constraint=models.UniqueConstraint(fields=['academy', 'name'], name='unique_tier_name_per_org')),
    ]
