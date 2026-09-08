"""One owner, several academies.

The shape the product is sold in: somebody signs up, creates an academy, and
later creates another. Each is a tenant of its own with nothing shared — a
member, an invoice or a membership in one is invisible from the other. The
owner moves between them; a manager they hired for one has no idea the other
exists.

Each academy picks its own verticals, so the same owner can run a gym in one
and a swimming school in another.
"""

from datetime import date

from organizations.constants import Role
from organizations.models import Membership, Organization
from students.models import Student

from .base import TenantAPITestCase, make_user


class MultiAcademyTestCase(TenantAPITestCase):
    def setUp(self):
        super().setUp()
        # self.org (demo) already has self.owner. Give that same person a
        # second academy, in a different sport.
        self.second = Organization.objects.create(
            name="Second Academy", slug="second", verticals=["swimming"]
        )
        Membership.objects.create(
            organization=self.second, user_id="owner-1",
            email="owner@example.com", role=Role.OWNER,
        )
        self.second_manager = self.add_member(
            self.second, "manager-2", "manager2@example.com", Role.MANAGER
        )

    def create_academy(self, actor, name, slug, verticals):
        """Sign up a new academy the way the front page does."""
        client = self.client_for(actor)
        return client.post(
            "/api/organizations/signup/",
            {"name": name, "slug": slug, "verticals": verticals},
            format="json",
        )


class OwnerAcademiesTests(MultiAcademyTestCase):
    def test_an_owner_sees_every_academy_they_own(self):
        response = self.client_for(self.owner).get("/api/organizations/mine/")
        slugs = {row["organization"]["slug"] for row in response.data["results"]}
        self.assertEqual(slugs, {self.org.slug, "second"})

    def test_an_owner_can_open_and_edit_both(self):
        for organization in (self.org, self.second):
            client = self.client_for(self.owner, organization=organization)
            self.assertEqual(client.get("/api/organizations/current/").status_code, 200)
            self.assertEqual(
                client.patch(
                    "/api/organizations/current/", {"name": "Renamed"}, format="json"
                ).status_code,
                200,
            )

    def test_an_owner_can_create_another_academy(self):
        """Creating a second one is the whole point — the signup endpoint must
        not be a once-per-person thing."""
        response = self.create_academy(self.owner, "Third", "third", ["karate"])
        self.assertEqual(response.status_code, 201)

        mine = self.client_for(self.owner).get("/api/organizations/mine/")
        self.assertEqual(mine.data["count"], 3)

    def test_each_academy_picks_its_own_verticals(self):
        """A gym in one and a swimming school in another, same owner."""
        self.assertEqual(self.org.verticals, ["gym", "fitness"])
        self.assertEqual(self.second.verticals, ["swimming"])

        gym_only = self.client_for(self.owner, organization=self.second)
        self.assertEqual(gym_only.get("/api/gym-ops/tiers/").status_code, 403)

    def test_a_new_academy_starts_empty(self):
        Student.objects.create(
            organization=self.org, full_name="Existing", joined_on=date(2026, 1, 1)
        )
        response = self.client_for(self.owner, organization=self.second).get(
            "/api/students/"
        )
        self.assertEqual(response.data["count"], 0)


class ManagerIsBoundToOneAcademyTests(MultiAcademyTestCase):
    """A manager hired for one academy must not learn the other exists."""

    def test_a_manager_only_lists_their_own_academy(self):
        response = self.client_for(self.manager).get("/api/organizations/mine/")
        slugs = {row["organization"]["slug"] for row in response.data["results"]}
        self.assertEqual(slugs, {self.org.slug})

    def test_a_manager_cannot_open_the_other_academy(self):
        response = self.client_for(self.manager, organization=self.second).get(
            "/api/organizations/current/"
        )
        self.assertIn(response.status_code, (403, 404))

    def test_a_manager_cannot_read_the_other_academys_members(self):
        Student.objects.create(
            organization=self.second, full_name="Theirs", joined_on=date(2026, 1, 1)
        )
        response = self.client_for(self.manager, organization=self.second).get(
            "/api/students/"
        )
        self.assertIn(response.status_code, (403, 404))

    def test_a_manager_cannot_write_into_the_other_academy(self):
        response = self.client_for(self.manager, organization=self.second).post(
            "/api/students/",
            {"full_name": "Sneaked In", "joined_on": "2026-01-01"},
            format="json",
        )
        self.assertIn(response.status_code, (403, 404))

    def test_a_manager_cannot_rename_the_other_academy(self):
        response = self.client_for(self.manager, organization=self.second).patch(
            "/api/organizations/current/", {"name": "Mine now"}, format="json"
        )
        self.assertIn(response.status_code, (403, 404))

    def test_a_manager_cannot_see_the_other_academys_team(self):
        response = self.client_for(self.manager, organization=self.second).get(
            "/api/organizations/current/team/"
        )
        self.assertIn(response.status_code, (403, 404))

    def test_managing_one_academy_says_nothing_about_the_other(self):
        """The same person can be manager here and nothing there."""
        self.assertFalse(
            Membership.objects.filter(
                organization=self.second, user_id="manager-1"
            ).exists()
        )


class AcademiesDoNotLeakIntoEachOtherTests(MultiAcademyTestCase):
    """Two academies of the *same* owner are still two tenants."""

    def setUp(self):
        super().setUp()
        self.here = Student.objects.create(
            organization=self.org, full_name="Ours", joined_on=date(2026, 1, 1)
        )
        self.there = Student.objects.create(
            organization=self.second, full_name="Theirs", joined_on=date(2026, 1, 1)
        )

    def test_a_member_of_one_is_not_reachable_from_the_other(self):
        response = self.client_for(self.owner, organization=self.second).get(
            f"/api/students/{self.here.id}/"
        )
        self.assertEqual(response.status_code, 404)

    def test_each_academy_counts_only_its_own(self):
        for organization, expected in ((self.org, "Ours"), (self.second, "Theirs")):
            response = self.client_for(self.owner, organization=organization).get(
                "/api/students/"
            )
            self.assertEqual(
                [row["full_name"] for row in response.data["results"]], [expected]
            )

    def test_branches_do_not_cross_academies(self):
        self.client_for(self.owner).post(
            "/api/organizations/current/branches/", {"name": "Andheri"}, format="json"
        )
        response = self.client_for(self.owner, organization=self.second).get(
            "/api/organizations/current/branches/"
        )
        self.assertEqual(response.data["count"], 0)

    def test_a_team_member_of_one_is_not_on_the_others_team(self):
        response = self.client_for(self.owner, organization=self.second).get(
            "/api/organizations/current/team/"
        )
        emails = {row["email"] for row in response.data["results"]}
        self.assertNotIn("manager@example.com", emails)
        self.assertIn("manager2@example.com", emails)


class NewOwnerTests(MultiAcademyTestCase):
    """Somebody with no academy at all signing up for their first."""

    def test_a_stranger_can_create_their_first_academy_and_owns_it(self):
        stranger = make_user("stranger-1", "stranger@example.com")
        response = self.create_academy(stranger, "Brand New", "brandnew", ["karate"])
        self.assertEqual(response.status_code, 201)

        membership = Membership.objects.get(
            organization__slug="brandnew", user_id="stranger-1"
        )
        self.assertEqual(membership.role, Role.OWNER)

    def test_a_stranger_sees_nothing_until_they_have_one(self):
        stranger = make_user("stranger-2", "stranger2@example.com")
        response = self.client_for(stranger).get("/api/organizations/mine/")
        self.assertEqual(response.data["count"], 0)

    def test_two_academies_cannot_share_a_slug(self):
        """The slug is the subdomain, so it decides which tenant a request
        lands in."""
        stranger = make_user("stranger-3", "stranger3@example.com")
        response = self.create_academy(stranger, "Clash", self.org.slug, ["gym"])
        self.assertEqual(response.status_code, 400)
