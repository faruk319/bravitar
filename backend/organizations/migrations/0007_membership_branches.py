from django.db import migrations, models


def grant_existing_access(apps, schema_editor):
    """Everyone already had every branch; write that down rather than blinding
    every manager on deploy. The new "none means none" rule applies to people
    invited from now on."""
    Membership = apps.get_model("organizations", "Membership")
    Branch = apps.get_model("organizations", "Branch")

    for membership in Membership.objects.exclude(role="owner").iterator():
        branches = Branch.objects.filter(organization_id=membership.organization_id)
        if branches.exists():
            membership.branches.set(branches)


class Migration(migrations.Migration):
    dependencies = [
        ("organizations", "0006_membership_requires_payment"),
    ]

    operations = [
        migrations.AddField(
            model_name="membership",
            name="branches",
            field=models.ManyToManyField(
                blank=True, related_name="team", to="organizations.branch"
            ),
        ),
        migrations.RunPython(grant_existing_access, migrations.RunPython.noop),
    ]
