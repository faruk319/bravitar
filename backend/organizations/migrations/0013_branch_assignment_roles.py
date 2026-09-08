import django.db.models.deletion
from django.db import migrations, models


def carry_assignments_over(apps, schema_editor):
    """Keep everyone where they already worked.

    The plain many-to-many is being replaced by a through model, so its rows
    would otherwise go with the table. Each assignment takes the person's
    organization-wide role, which is effectively what it was before.
    """
    Membership = apps.get_model("organizations", "Membership")
    BranchAssignment = apps.get_model("organizations", "BranchAssignment")

    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT membership_id, branch_id FROM organizations_membership_branches"
        )
        rows = cursor.fetchall()

    roles = dict(Membership.objects.values_list("id", "role"))
    BranchAssignment.objects.bulk_create(
        [
            BranchAssignment(
                membership_id=membership_id,
                branch_id=branch_id,
                role=roles.get(membership_id) or "manager",
            )
            for membership_id, branch_id in rows
        ],
        ignore_conflicts=True,
    )


class Migration(migrations.Migration):
    dependencies = [("organizations", "0012_branch_verticals")]

    operations = [
        migrations.CreateModel(
            name="BranchAssignment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("role", models.CharField(choices=[("owner", "Owner"), ("manager", "Manager"), ("staff", "Staff / Trainer"), ("member", "Member")], default="manager", max_length=20)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("branch", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="assignments", to="organizations.branch")),
                ("membership", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="assignments", to="organizations.membership")),
            ],
            options={"ordering": ["branch__name", "id"]},
        ),
        migrations.AddConstraint(
            model_name="branchassignment",
            constraint=models.UniqueConstraint(
                fields=("membership", "branch"), name="one_role_per_person_per_branch"
            ),
        ),
        migrations.RunPython(carry_assignments_over, migrations.RunPython.noop),
        # Django refuses to alter a plain M2M into a through one, so the state
        # is changed on its own and the old join table dropped by hand.
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.RemoveField(model_name="membership", name="branches"),
                migrations.AddField(
                    model_name="membership",
                    name="branches",
                    field=models.ManyToManyField(
                        blank=True, related_name="team",
                        through="organizations.BranchAssignment",
                        to="organizations.branch",
                    ),
                ),
            ],
            database_operations=[
                migrations.RunSQL(
                    "DROP TABLE IF EXISTS organizations_membership_branches;",
                    migrations.RunSQL.noop,
                )
            ],
        ),
    ]
