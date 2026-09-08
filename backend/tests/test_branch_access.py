"""Branch access: which locations of an academy a person may work in.

The rule the owner chose: nobody sees a branch until they are assigned to it.
An academy with no branches is exempt, because most academies are one place
and should never meet this feature.

These read like the cross-tenant tests on purpose. A manager reaching into
another branch is the same class of mistake as reaching into another academy,
just quieter — the data looks plausible, so nothing tips them off.
"""

from datetime import date
from decimal import Decimal

from organizations.constants import Role
from organizations.models import Branch, Membership
from students.models import Student

from .base import TenantAPITestCase


class BranchTestCase(TenantAPITestCase):
    def setUp(self):
        super().setUp()
        self.andheri = Branch.objects.create(academy=self.org, name="Andheri")
        self.bandra = Branch.objects.create(academy=self.org, name="Bandra")

        self.here = Student.objects.create(
            academy=self.org, branch=self.andheri,
            full_name="Andheri Member", joined_on=date(2026, 1, 1),
        )
        self.there = Student.objects.create(
            academy=self.org, branch=self.bandra,
            full_name="Bandra Member", joined_on=date(2026, 1, 1),
        )
        self.floating = Student.objects.create(
            academy=self.org, branch=None,
            full_name="No Branch", joined_on=date(2026, 1, 1),
        )

        self.membership = Membership.objects.get(
            organization=self.org.organization, user_id="manager-1"
        )

    def assign(self, *branches):
        self.membership.branches.set(branches)

    def names_seen_by(self, actor):
        response = self.client_for(actor).get("/api/students/")
        self.assertEqual(response.status_code, 200)
        return {row["full_name"] for row in response.data["results"]}


class MembersAreVisibleEverywhereTests(BranchTestCase):
    """Members are findable from any branch — somebody who walks into the
    wrong one still has to be servable at the desk. Everything about them
    that is a decision, not a lookup, stays with their own branch."""

    def test_a_manager_with_no_branch_can_still_find_members(self):
        self.assertEqual(
            self.names_seen_by(self.manager),
            {"Andheri Member", "Bandra Member", "No Branch"},
        )

    def test_an_owner_always_sees_every_branch(self):
        self.assertEqual(
            self.names_seen_by(self.owner),
            {"Andheri Member", "Bandra Member", "No Branch"},
        )

    def test_a_manager_with_no_branch_sees_no_batches(self):
        """Access is granted, never assumed — for everything but finding a
        member."""
        from batches.models import Batch

        Batch.objects.create(academy=self.org, name="Morning", branch=self.andheri)
        response = self.client_for(self.manager).get("/api/batches/")
        self.assertEqual(response.data["count"], 0)

    def test_assigning_a_branch_opens_exactly_that_branch(self):
        from batches.models import Batch

        Batch.objects.create(academy=self.org, name="Andheri AM", branch=self.andheri)
        Batch.objects.create(academy=self.org, name="Bandra AM", branch=self.bandra)
        self.assign(self.andheri)

        response = self.client_for(self.manager).get("/api/batches/")
        self.assertEqual(
            {row["name"] for row in response.data["results"]}, {"Andheri AM"}
        )


class SingleLocationAcademiesAreExemptTests(TenantAPITestCase):
    """An academy with no branches must never meet this feature."""

    def test_a_manager_sees_everything_when_there_are_no_branches(self):
        Student.objects.create(
            academy=self.org, full_name="Only Member", joined_on=date(2026, 1, 1)
        )
        response = self.client_for(self.manager).get("/api/students/")
        self.assertEqual(response.data["count"], 1)


class LookingIsAllowedChangingIsNotTests(BranchTestCase):
    """The line the owner drew: see anyone, edit only your own."""

    def setUp(self):
        super().setUp()
        self.assign(self.andheri)

    def test_a_member_of_another_branch_can_be_opened(self):
        response = self.client_for(self.manager).get(f"/api/students/{self.there.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["full_name"], "Bandra Member")

    def test_their_money_is_not_visible(self):
        """Seeing who somebody is doesn't mean seeing what they owe."""
        from decimal import Decimal

        from billing.models import Invoice

        Invoice.objects.create(
            academy=self.org, student=self.there, description="theirs",
            amount=Decimal("1000.00"),
            issued_on=date(2026, 1, 1), due_on=date(2026, 1, 1),
        )
        response = self.client_for(self.manager).get("/api/billing/invoices/")
        self.assertEqual(response.data["count"], 0)

    def test_a_member_of_another_branch_cannot_be_edited(self):
        response = self.client_for(self.manager).patch(
            f"/api/students/{self.there.id}/", {"full_name": "Mine now"}, format="json"
        )
        self.assertEqual(response.status_code, 404)

    def test_a_member_of_another_branch_cannot_be_deleted(self):
        response = self.client_for(self.manager).delete(f"/api/students/{self.there.id}/")
        self.assertEqual(response.status_code, 404)


class WritesRespectBranchesTests(BranchTestCase):
    def setUp(self):
        super().setUp()
        self.assign(self.andheri)

    def test_a_member_can_be_created_in_your_own_branch(self):
        response = self.client_for(self.manager).post(
            "/api/students/",
            {"full_name": "New", "joined_on": "2026-01-01", "branch": self.andheri.id},
            format="json",
        )
        self.assertEqual(response.status_code, 201)

    def test_a_member_cannot_be_created_in_someone_elses_branch(self):
        """Scoping the queryset only stops reads; a write needs its own check."""
        response = self.client_for(self.manager).post(
            "/api/students/",
            {"full_name": "Sneaked", "joined_on": "2026-01-01", "branch": self.bandra.id},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("branch", str(response.data).lower())

    def test_a_member_cannot_be_moved_out_of_your_branch(self):
        response = self.client_for(self.manager).patch(
            f"/api/students/{self.here.id}/", {"branch": self.bandra.id}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_a_batch_cannot_be_created_in_someone_elses_branch(self):
        response = self.client_for(self.manager).post(
            "/api/batches/",
            {"name": "Theirs", "branch": self.bandra.id, "days_of_week": [0]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)


class BranchFollowsTheMemberTests(BranchTestCase):
    """Invoices and memberships have no branch of their own — they inherit the
    member's. Without that, the money screens leak straight past the boundary.
    """

    def setUp(self):
        super().setUp()
        self.assign(self.andheri)
        from billing.models import Invoice

        for student, description in ((self.here, "ours"), (self.there, "theirs")):
            Invoice.objects.create(
                academy=self.org, student=student, description=description,
                amount=Decimal("1000.00"),
                issued_on=date(2026, 1, 1), due_on=date(2026, 1, 1),
            )

    def test_invoices_follow_the_members_branch(self):
        response = self.client_for(self.manager).get("/api/billing/invoices/")
        self.assertEqual(
            {row["description"] for row in response.data["results"]}, {"ours"}
        )

    def test_memberships_follow_the_members_branch(self):
        from subscriptions.constants import BillingPeriod
        from subscriptions.models import MembershipTier

        self.org.verticals = ["gym"]
        self.org.save()
        tier = MembershipTier.objects.create(
            academy=self.org, name="Monthly", period=BillingPeriod.MONTHLY,
            duration_days=30, price=Decimal("1500.00"),
        )
        for student in (self.here, self.there):
            self.client_for(self.owner).post(
                "/api/gym-ops/subscriptions/",
                {"student": student.id, "tier": tier.id, "started_on": "2026-09-01"},
                format="json",
            )

        response = self.client_for(self.manager).get("/api/gym-ops/subscriptions/")
        self.assertEqual(
            {row["student_name"] for row in response.data["results"]}, {"Andheri Member"}
        )

    def test_check_ins_follow_their_branch(self):
        from attendance.models import CheckIn

        self.org.verticals = ["gym"]
        self.org.save()
        for student, branch in ((self.here, self.andheri), (self.there, self.bandra)):
            CheckIn.objects.create(
                academy=self.org, student=student, branch=branch, admitted=True
            )

        response = self.client_for(self.manager).get("/api/attendance/checkins/")
        self.assertEqual(
            {row["student_name"] for row in response.data["results"]}, {"Andheri Member"}
        )


class UnbranchedRecordsStayVisibleTests(BranchTestCase):
    """A member with no branch belongs to the academy, not to a location.

    Hiding them would make a walk-in unfindable at the desk and impossible to
    check in — worse than showing them.
    """

    def setUp(self):
        super().setUp()
        self.assign(self.andheri)

    def test_an_unbranched_member_is_visible(self):
        self.assertIn("No Branch", self.names_seen_by(self.manager))

    def test_an_unbranched_member_can_be_opened(self):
        response = self.client_for(self.manager).get(f"/api/students/{self.floating.id}/")
        self.assertEqual(response.status_code, 200)


class ApiKeysAreNotBranchScopedTests(BranchTestCase):
    """A key acts for the academy; there is no person behind it to assign."""

    def test_a_key_sees_every_branch(self):
        from rest_framework.test import APIClient

        from organizations.models import APIKey

        from .base import BASE_DOMAIN

        _, raw = APIKey.generate(self.org.organization, name="their app")
        client = APIClient(HTTP_HOST=f"{self.org.slug}.{BASE_DOMAIN}")
        client.credentials(HTTP_X_API_KEY=raw)

        response = client.get("/api/students/")
        self.assertEqual(response.data["count"], 3)


class OwnersAreNeverRestrictedTests(BranchTestCase):
    def test_assigning_an_owner_a_branch_changes_nothing(self):

        owner_membership = Membership.objects.get(
            organization=self.org.organization, user_id="owner-1"
        )
        self.assertEqual(owner_membership.role, Role.OWNER)
        owner_membership.branches.set([self.andheri])

        self.assertEqual(
            self.names_seen_by(self.owner),
            {"Andheri Member", "Bandra Member", "No Branch"},
        )


class AssigningBranchesTests(BranchTestCase):
    """Only an owner hands out branches, and only their own."""

    def row_for(self, actor, email="manager@example.com"):
        response = self.client_for(actor).get("/api/organizations/current/team/")
        return next(r for r in response.data["results"] if r["email"] == email)

    def test_the_team_list_shows_who_works_where(self):
        self.assign(self.andheri)
        row = self.row_for(self.owner)
        self.assertEqual(row["branch_names"], ["Andheri"])

    def test_an_owner_can_assign_branches(self):
        response = self.client_for(self.owner).patch(
            f"/api/organizations/current/team/{self.membership.id}/",
            {"branches": [self.andheri.id, self.bandra.id]}, format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            set(self.membership.branches.values_list("name", flat=True)),
            {"Andheri", "Bandra"},
        )

    def test_a_manager_cannot_assign_themselves_a_branch(self):
        """Otherwise the boundary is decoration."""
        response = self.client_for(self.manager).patch(
            f"/api/organizations/current/team/{self.membership.id}/",
            {"branches": [self.bandra.id]}, format="json",
        )
        self.assertIn(response.status_code, (403, 404))
        self.assertEqual(self.membership.branches.count(), 0)

    def test_a_branch_from_another_academy_is_refused(self):
        theirs = Branch.objects.create(academy=self.other_org, name="Not Ours")
        response = self.client_for(self.owner).patch(
            f"/api/organizations/current/team/{self.membership.id}/",
            {"branches": [theirs.id]}, format="json",
        )
        self.assertEqual(response.status_code, 400)


class TransferringAMemberTests(BranchTestCase):
    """Seeing a member from another branch is allowed; taking them is asked
    for. The branch losing them decides, or branches would pull members off
    each other."""

    def setUp(self):
        super().setUp()
        self.assign(self.andheri)
        self.bandra_manager = self.add_member(
            self.org, "manager-b", "bandra@example.com", Role.MANAGER
        )
        Membership.objects.get(
            organization=self.org.organization, user_id="manager-b"
        ).branches.set([self.bandra])

    def ask_for(self, student, to_branch, actor=None):
        return self.client_for(actor or self.manager).post(
            "/api/students/transfers/",
            {"student": student.id, "to_branch": to_branch.id, "reason": "moved house"},
            format="json",
        )

    def test_a_manager_can_ask_for_a_member_from_another_branch(self):
        response = self.ask_for(self.there, self.andheri)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["status"], "pending")
        self.assertEqual(response.data["from_branch_name"], "Bandra")

    def test_asking_does_not_move_them(self):
        self.ask_for(self.there, self.andheri)
        self.there.refresh_from_db()
        self.assertEqual(self.there.branch, self.bandra)

    def test_you_cannot_ask_for_them_to_go_to_a_branch_you_do_not_work_at(self):
        response = self.ask_for(self.there, self.bandra)
        self.assertEqual(response.status_code, 400)

    def test_the_asking_branch_cannot_approve_its_own_request(self):
        """Otherwise asking would be a formality."""
        created = self.ask_for(self.there, self.andheri)
        response = self.client_for(self.manager).post(
            f"/api/students/transfers/{created.data['id']}/approve/"
        )
        self.assertEqual(response.status_code, 403)
        self.there.refresh_from_db()
        self.assertEqual(self.there.branch, self.bandra)

    def test_the_losing_branch_approves_and_the_member_moves(self):
        created = self.ask_for(self.there, self.andheri)
        response = self.client_for(self.bandra_manager).post(
            f"/api/students/transfers/{created.data['id']}/approve/"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "approved")

        self.there.refresh_from_db()
        self.assertEqual(self.there.branch, self.andheri)

    def test_an_owner_can_approve_either_way(self):
        created = self.ask_for(self.there, self.andheri)
        response = self.client_for(self.owner).post(
            f"/api/students/transfers/{created.data['id']}/approve/"
        )
        self.assertEqual(response.status_code, 200)

    def test_approval_hands_over_editing_too(self):
        created = self.ask_for(self.there, self.andheri)
        self.client_for(self.bandra_manager).post(
            f"/api/students/transfers/{created.data['id']}/approve/"
        )
        response = self.client_for(self.manager).patch(
            f"/api/students/{self.there.id}/", {"phone": "9999999999"}, format="json"
        )
        self.assertEqual(response.status_code, 200)

    def test_declining_leaves_them_where_they_are(self):
        created = self.ask_for(self.there, self.andheri)
        self.client_for(self.bandra_manager).post(
            f"/api/students/transfers/{created.data['id']}/decline/"
        )
        self.there.refresh_from_db()
        self.assertEqual(self.there.branch, self.bandra)

    def test_the_asking_branch_can_withdraw(self):
        created = self.ask_for(self.there, self.andheri)
        response = self.client_for(self.manager).post(
            f"/api/students/transfers/{created.data['id']}/withdraw/"
        )
        self.assertEqual(response.data["status"], "withdrawn")

    def test_only_one_request_is_open_for_a_member_at_a_time(self):
        self.ask_for(self.there, self.andheri)
        again = self.ask_for(self.there, self.andheri)
        self.assertEqual(again.status_code, 400)

    def test_a_decided_request_cannot_be_decided_again(self):
        created = self.ask_for(self.there, self.andheri)
        self.client_for(self.bandra_manager).post(
            f"/api/students/transfers/{created.data['id']}/approve/"
        )
        again = self.client_for(self.bandra_manager).post(
            f"/api/students/transfers/{created.data['id']}/decline/"
        )
        self.assertEqual(again.status_code, 404)

    def test_both_branches_see_the_request(self):
        self.ask_for(self.there, self.andheri)
        for actor in (self.manager, self.bandra_manager):
            response = self.client_for(actor).get("/api/students/transfers/?open=true")
            self.assertEqual(response.data["count"], 1, f"{actor.email} can't see it")

    def test_an_unrelated_branch_does_not_see_it(self):
        colaba = Branch.objects.create(academy=self.org, name="Colaba")
        outsider = self.add_member(
            self.org, "manager-c", "colaba@example.com", Role.MANAGER
        )
        Membership.objects.get(
            organization=self.org.organization, user_id="manager-c"
        ).branches.set([colaba])

        self.ask_for(self.there, self.andheri)
        response = self.client_for(outsider).get("/api/students/transfers/")
        self.assertEqual(response.data["count"], 0)

    def test_a_key_cannot_move_anybody(self):
        from rest_framework.test import APIClient

        from organizations.models import APIKey

        from .base import BASE_DOMAIN

        _, raw = APIKey.generate(self.org.organization, name="their app")
        client = APIClient(HTTP_HOST=f"{self.org.organization.slug}.{BASE_DOMAIN}")
        client.credentials(HTTP_X_API_KEY=raw)

        response = client.post(
            "/api/students/transfers/",
            {"student": self.there.id, "to_branch": self.andheri.id},
            format="json",
        )
        self.assertIn(response.status_code, (401, 403))
