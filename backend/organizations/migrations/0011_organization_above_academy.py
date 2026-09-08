import django.db.models.deletion
from django.db import migrations, models


def lift_academies_into_organizations(apps, schema_editor):
    """Give every existing academy an organization of its own.

    One-to-one keeps today's behaviour exactly: the subdomain that reached an
    academy now reaches its organization, which has that one academy in it.
    Splitting or merging them later is the owner's decision, not a migration's.
    """
    Organization = apps.get_model("organizations", "Organization")
    Academy = apps.get_model("organizations", "Academy")
    Membership = apps.get_model("organizations", "Membership")
    APIKey = apps.get_model("organizations", "APIKey")

    for academy in Academy.objects.all().iterator():
        organization = Organization.objects.create(
            name=academy.name,
            slug=academy.slug,
            plan=academy.plan,
            custom_domain=academy.custom_domain,
            domain_verified=academy.domain_verified,
        )
        Academy.objects.filter(pk=academy.pk).update(organization=organization)
        Membership.objects.filter(academy=academy).update(organization=organization)
        APIKey.objects.filter(academy=academy).update(organization=organization)


class Migration(migrations.Migration):
    dependencies = [("organizations", "0009_rename_organization_to_academy")]

    operations = [
        migrations.RunSQL(
            [
                'ALTER INDEX IF EXISTS organizations_organization_pkey RENAME TO organizations_academy_pkey;',
                'ALTER INDEX IF EXISTS organizations_organization_slug_key RENAME TO organizations_academy_slug_key;',
                'ALTER INDEX IF EXISTS organizations_organization_slug_e36fd8f9_like RENAME TO organizations_academy_slug_like;',
                'ALTER INDEX IF EXISTS organizations_organization_custom_domain_key RENAME TO organizations_academy_custom_domain_key;',
                'ALTER INDEX IF EXISTS organizations_organization_custom_domain_53002f83_like RENAME TO organizations_academy_custom_domain_like;',
            ],
            migrations.RunSQL.noop,
        ),
        migrations.CreateModel(
            name="Organization",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=255)),
                ("slug", models.SlugField(unique=True)),
                ("plan", models.CharField(choices=[("free", "Free"), ("pro", "Pro"), ("enterprise", "Enterprise")], default="free", max_length=20)),
                ("custom_domain", models.CharField(blank=True, max_length=255, null=True, unique=True)),
                ("domain_verified", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["name", "id"]},
        ),
        migrations.AddField(
            model_name="academy",
            name="organization",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, related_name="academies", to="organizations.organization"),
        ),
        migrations.AddField(
            model_name="membership",
            name="organization",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, related_name="memberships", to="organizations.organization"),
        ),
        migrations.AddField(
            model_name="apikey",
            name="organization",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, related_name="api_keys", to="organizations.organization"),
        ),
        migrations.RunPython(lift_academies_into_organizations, migrations.RunPython.noop),
        # The old uniqueness was per academy; it is per organization now.
        migrations.RemoveConstraint(model_name="membership", name="one_membership_per_user_per_org"),
        migrations.RemoveConstraint(model_name="membership", name="one_membership_per_email_per_org"),
        migrations.RemoveField(model_name="membership", name="academy"),
        migrations.RemoveField(model_name="apikey", name="academy"),
        migrations.AddConstraint(
            model_name="membership",
            constraint=models.UniqueConstraint(fields=("organization", "user_id"), name="one_membership_per_user_per_org", condition=models.Q(("user_id", ""), _negated=True)),
        ),
        migrations.AddConstraint(
            model_name="membership",
            constraint=models.UniqueConstraint(fields=("organization", "email"), name="one_membership_per_email_per_org", condition=models.Q(("email", ""), _negated=True)),
        ),
        # The subdomain, the domain and the plan are the organization's now.
        migrations.RemoveField(model_name="academy", name="plan"),
        migrations.RemoveField(model_name="academy", name="custom_domain"),
        migrations.RemoveField(model_name="academy", name="domain_verified"),
    ]
