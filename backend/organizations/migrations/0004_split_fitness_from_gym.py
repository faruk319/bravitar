from django.db import migrations


def add_fitness_to_gyms(apps, schema_editor):
    """Fitness tracking used to live inside the gym vertical.

    Splitting them would otherwise take the exercise library, workouts,
    nutrition and body log away from every academy already using them, so
    anyone on `gym` gains `fitness` and sees no change.
    """
    Organization = apps.get_model("organizations", "Organization")

    for org in Organization.objects.all():
        verticals = org.verticals or []
        if "gym" in verticals and "fitness" not in verticals:
            org.verticals = verticals + ["fitness"]
            org.save(update_fields=["verticals"])


def remove_fitness(apps, schema_editor):
    Organization = apps.get_model("organizations", "Organization")
    for org in Organization.objects.all():
        verticals = org.verticals or []
        if "fitness" in verticals:
            org.verticals = [v for v in verticals if v != "fitness"]
            org.save(update_fields=["verticals"])


class Migration(migrations.Migration):
    dependencies = [("organizations", "0003_alter_apikey_options_alter_branch_options")]
    operations = [migrations.RunPython(add_fitness_to_gyms, remove_fitness)]
