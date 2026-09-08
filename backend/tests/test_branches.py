"""Managing the branches themselves — add, edit, delete, and the primary one."""

from datetime import date

from organizations.models import Branch
from students.models import Student

from .base import TenantAPITestCase


class BranchAdminTestCase(TenantAPITestCase):
    def create(self, actor=None, **overrides):
        payload = {"name": "Andheri", "address": "Andheri West, Mumbai"}
        payload.update(overrides)
        return self.client_for(actor or self.owner).post(
            "/api/organizations/current/branches/", payload, format="json"
        )


class BranchDetailsTests(BranchAdminTestCase):
    def test_a_branch_carries_its_own_contact_details(self):
        response = self.create(phone="02226001234", email="andheri@example.com")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["phone"], "02226001234")
        self.assertEqual(response.data["email"], "andheri@example.com")

    def test_details_can_be_edited(self):
        branch = self.create().data
        response = self.client_for(self.owner).patch(
            f"/api/organizations/current/branches/{branch['id']}/",
            {"name": "Andheri West", "phone": "9999999999"}, format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["name"], "Andheri West")
        self.assertEqual(response.data["phone"], "9999999999")

    def test_an_empty_branch_can_be_deleted(self):
        branch = self.create().data
        response = self.client_for(self.owner).delete(
            f"/api/organizations/current/branches/{branch['id']}/"
        )
        self.assertEqual(response.status_code, 204)

    def test_a_branch_with_members_cannot_be_deleted(self):
        """Students point at a branch with SET_NULL, so deleting one would
        quietly unfile everybody standing in it."""
        branch = Branch.objects.create(academy=self.org, name="Bandra")
        Student.objects.create(
            academy=self.org, branch=branch,
            full_name="Somebody", joined_on=date(2026, 1, 1),
        )
        response = self.client_for(self.owner).delete(
            f"/api/organizations/current/branches/{branch.id}/"
        )
        self.assertEqual(response.status_code, 400)
        self.assertTrue(Branch.objects.filter(pk=branch.id).exists())

    def test_a_branch_reports_who_works_there(self):
        branch = Branch.objects.create(academy=self.org, name="Bandra")
        self.assertEqual(self.branch_row(branch)["team_count"], 0)

        from organizations.models import Membership

        Membership.objects.get(organization=self.org.organization, user_id="manager-1").branches.add(branch)
        self.assertEqual(self.branch_row(branch)["team_count"], 1)

    def test_owners_are_not_counted_as_branch_staff(self):
        """They are never branch-restricted, so counting them would read as a
        limit that isn't there."""
        from organizations.models import Membership

        branch = Branch.objects.create(academy=self.org, name="Bandra")
        Membership.objects.get(organization=self.org.organization, user_id="owner-1").branches.add(branch)
        self.assertEqual(self.branch_row(branch)["team_count"], 0)

    def branch_row(self, branch):
        response = self.client_for(self.owner).get("/api/organizations/current/branches/")
        return next(r for r in response.data["results"] if r["id"] == branch.id)


class OnlyOwnersManageBranchesTests(BranchAdminTestCase):
    def test_a_manager_cannot_add_a_branch(self):
        self.assertIn(self.create(actor=self.manager).status_code, (403, 404))

    def test_a_manager_cannot_edit_a_branch(self):
        branch = self.create().data
        response = self.client_for(self.manager).patch(
            f"/api/organizations/current/branches/{branch['id']}/",
            {"name": "Mine now"}, format="json",
        )
        self.assertIn(response.status_code, (403, 404))

    def test_a_manager_cannot_delete_a_branch(self):
        branch = self.create().data
        response = self.client_for(self.manager).delete(
            f"/api/organizations/current/branches/{branch['id']}/"
        )
        self.assertIn(response.status_code, (403, 404))

    def test_another_academy_cannot_reach_our_branches(self):
        branch = self.create().data
        response = self.client_for(self.other_owner, academy=self.other_org).patch(
            f"/api/organizations/current/branches/{branch['id']}/",
            {"name": "Theirs"}, format="json",
        )
        self.assertIn(response.status_code, (403, 404))


class PrimaryBranchTests(BranchAdminTestCase):
    """The primary branch is where a member with no branch named lands.

    It had to mean something or stop existing — a toggle that changes nothing
    is worse than no toggle.
    """

    def test_only_one_branch_can_be_primary(self):
        first = self.create(name="Andheri", is_primary=True).data
        second = self.create(name="Bandra", is_primary=True).data

        self.assertFalse(Branch.objects.get(pk=first["id"]).is_primary)
        self.assertTrue(Branch.objects.get(pk=second["id"]).is_primary)

    def test_a_new_member_lands_in_the_primary_branch(self):
        primary = self.create(name="Andheri", is_primary=True).data
        self.create(name="Bandra")

        response = self.client_for(self.owner).post(
            "/api/students/", {"full_name": "Walk In", "joined_on": "2026-01-01"},
            format="json",
        )
        self.assertEqual(response.data["branch"], primary["id"])

    def test_naming_a_branch_still_wins(self):
        self.create(name="Andheri", is_primary=True)
        bandra = self.create(name="Bandra").data

        response = self.client_for(self.owner).post(
            "/api/students/",
            {"full_name": "Walk In", "joined_on": "2026-01-01", "branch": bandra["id"]},
            format="json",
        )
        self.assertEqual(response.data["branch"], bandra["id"])

    def test_with_no_primary_a_member_stays_unfiled(self):
        self.create(name="Andheri")
        response = self.client_for(self.owner).post(
            "/api/students/", {"full_name": "Walk In", "joined_on": "2026-01-01"},
            format="json",
        )
        self.assertIsNone(response.data["branch"])

    def test_the_primary_of_one_academy_does_not_reach_another(self):
        self.create(name="Andheri", is_primary=True)
        Branch.objects.create(academy=self.other_org, name="Theirs", is_primary=True)

        primaries = Branch.objects.filter(is_primary=True).count()
        self.assertEqual(primaries, 2)


class BranchSportsTests(BranchAdminTestCase):
    """A branch offers a subset of the academy's sports. Empty means all of
    them, which is most branches — listing them again would only drift."""

    def test_a_branch_offers_everything_by_default(self):
        branch = self.create().data
        self.assertEqual(branch["verticals"], [])
        self.assertEqual(sorted(branch["offers"]), ["fitness", "gym"])

    def test_a_branch_can_offer_only_some_of_them(self):
        branch = self.create(verticals=["gym"]).data
        self.assertEqual(branch["offers"], ["gym"])

    def test_a_branch_cannot_offer_what_the_academy_does_not_run(self):
        response = self.create(verticals=["swimming"])
        self.assertEqual(response.status_code, 400)
        self.assertIn("swimming", str(response.data).lower())

    def test_dropping_a_sport_from_the_academy_drops_it_from_the_branch(self):
        """The branch list is a filter over the academy's, not a second copy
        that can drift out of step."""
        from organizations.models import Branch

        branch = Branch.objects.create(
            academy=self.org, name="Andheri", verticals=["gym", "fitness"]
        )
        self.org.verticals = ["gym"]
        self.org.save()

        self.assertEqual(branch.offers, ["gym"])


class AssigningWhoRunsABranchTests(BranchAdminTestCase):
    """A new branch needs somebody who can see it — an owner can put
    themselves on it or name someone as they create it."""

    def membership(self, user_id):
        from organizations.models import Membership

        return Membership.objects.get(
            organization=self.org.organization, user_id=user_id
        )

    def test_a_branch_can_be_created_with_its_manager(self):
        manager = self.membership("manager-1")
        response = self.create(managers=[manager.id])

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["team_count"], 1)
        self.assertEqual(
            list(manager.branches.values_list("name", flat=True)), ["Andheri"]
        )

    def test_a_branch_with_nobody_on_it_is_owner_only(self):
        response = self.create()
        self.assertEqual(response.data["team_count"], 0)

    def test_somebody_from_another_organization_cannot_be_put_on_it(self):
        response = self.create(managers=[self.membership_elsewhere().id])
        self.assertEqual(response.status_code, 400)

    def membership_elsewhere(self):
        from organizations.models import Membership

        return Membership.objects.get(
            organization=self.other_org.organization, user_id="owner-2"
        )

    def test_editing_replaces_who_runs_it(self):
        manager = self.membership("manager-1")
        branch = self.create(managers=[manager.id]).data

        self.client_for(self.owner).patch(
            f"/api/organizations/current/branches/{branch['id']}/",
            {"managers": []}, format="json",
        )
        self.assertEqual(manager.branches.count(), 0)
