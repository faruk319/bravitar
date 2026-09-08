from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('nutrition', '0001_initial'), ('organizations', '0009_rename_organization_to_academy')]

    operations = [
        migrations.RemoveConstraint(model_name='food', name='unique_org_food_slug'),
        migrations.RemoveConstraint(model_name='nutritionplan', name='one_nutrition_plan_per_user'),
        migrations.RenameField(model_name='food', old_name='organization', new_name='academy'),
        migrations.RenameField(model_name='foodlogentry', old_name='organization', new_name='academy'),
        migrations.RenameField(model_name='nutritionplan', old_name='organization', new_name='academy'),
        migrations.AddConstraint(model_name='food', constraint=models.UniqueConstraint(fields=['academy', 'slug'], name='unique_org_food_slug')),
        migrations.AddConstraint(model_name='nutritionplan', constraint=models.UniqueConstraint(fields=['academy', 'user_id'], name='one_nutrition_plan_per_user')),
    ]
