"""Three levels: organization → academy → branch.

The organization is the tenant — it owns the subdomain and the plan. Academies
live inside it and own everything operational. An organization with one academy
never meets the distinction, which is most of them; one with several has to say
which academy a request is for, because guessing would show the wrong books.
"""

from datetime import date

from organizations.constants import Role
from organizations.models import Academy, Membership, Organization
from students.models import Student

from .base import BASE_DOMAIN, TenantAPITestCase


class OrganizationOwnsTheSubdomainTests(TenantAPITestCase):
    def test_the_subdomain_is_the_organizations(self):
        self.assertEqual(self.org.organization.slug, "irontemple")

    def test_the_plan_belongs_to_the_organization(self):
        response = self.client_for(self.owner).get("/api/organizations/current/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["plan"], self.org.organization.plan)

    def test_a_verified_domain_reaches_the_organizations_academy(self):
        organization = self.org.organization
        organization.custom_domain = "gym.example.com"
        organization.domain_verified = True
        organization.save()

        client = self.client_for(self.owner)
        client.defaults["HTTP_HOST"] = "gym.example.com"
        self.assertEqual(client.get("/api/organizations/current/").data["slug"], "irontemple")


class PickingAnAcademyTests(TenantAPITestCase):
    """One academy resolves silently. Several need naming."""

    def add_second_academy(self):
        return Academy.objects.create(
            organization=self.org.organization,
            name="Aqua Wing", slug="aqua", verticals=["swimming"],
        )

    def client_asking_for(self, academy=None):
        client = self.client_for(self.owner)
        if academy:
            client.defaults["HTTP_X_ACADEMY"] = academy.slug
        return client

    def test_one_academy_needs_no_saying(self):
        response = self.client_for(self.owner).get("/api/organizations/current/")
        self.assertEqual(response.data["slug"], "irontemple")

    def test_two_academies_need_the_header(self):
        """Picking one for the caller would quietly show the wrong academy's
        members and money."""
        self.add_second_academy()
        response = self.client_for(self.owner).get("/api/organizations/current/")
        self.assertEqual(response.status_code, 403)

    def test_the_header_chooses_the_academy(self):
        second = self.add_second_academy()
        response = self.client_asking_for(second).get("/api/organizations/current/")
        self.assertEqual(response.data["slug"], "aqua")

    def test_an_academy_from_another_organization_is_not_reachable(self):
        response = self.client_asking_for(self.other_org).get(
            "/api/organizations/current/"
        )
        self.assertIn(response.status_code, (403, 404))

    def test_data_follows_the_chosen_academy(self):
        second = self.add_second_academy()
        Student.objects.create(
            academy=self.org, full_name="Gym Member", joined_on=date(2026, 1, 1)
        )
        Student.objects.create(
            academy=second, full_name="Swimmer", joined_on=date(2026, 1, 1)
        )

        names = lambda client: [  # noqa: E731
            row["full_name"] for row in client.get("/api/students/").data["results"]
        ]
        self.assertEqual(names(self.client_asking_for(self.org)), ["Gym Member"])
        self.assertEqual(names(self.client_asking_for(second)), ["Swimmer"])


class MembershipIsOrganizationWideTests(TenantAPITestCase):
    """A role is held in the organization; branches say which academies it
    reaches. There is no separate per-academy role to keep in step."""

    def test_a_membership_names_an_organization_not_an_academy(self):
        membership = Membership.objects.get(
            organization=self.org.organization, user_id="owner-1"
        )
        self.assertEqual(membership.organization, self.org.organization)

    def test_one_membership_covers_every_academy_in_the_organization(self):
        second = Academy.objects.create(
            organization=self.org.organization,
            name="Aqua Wing", slug="aqua", verticals=["swimming"],
        )
        client = self.client_for(self.owner)
        client.defaults["HTTP_X_ACADEMY"] = second.slug

        self.assertEqual(client.get("/api/organizations/current/").status_code, 200)
        self.assertEqual(
            Membership.objects.filter(
                organization=self.org.organization, user_id="owner-1"
            ).count(),
            1,
        )

    def test_your_academies_lists_them_under_their_organization(self):
        Academy.objects.create(
            organization=self.org.organization,
            name="Aqua Wing", slug="aqua", verticals=["swimming"],
        )
        response = self.client_for(self.owner).get("/api/organizations/mine/")
        row = next(
            r for r in response.data["results"]
            if r["organization"]["slug"] == "irontemple"
        )
        self.assertEqual(
            {a["slug"] for a in row["academies"]}, {"irontemple", "aqua"}
        )


class SigningUpCreatesBothTests(TenantAPITestCase):
    def test_signup_creates_an_organization_with_its_first_academy(self):
        from .base import make_user

        stranger = make_user("newbie-1", "newbie@example.com")
        response = self.client_for(stranger).post(
            "/api/organizations/signup/",
            {"name": "Fresh Start", "slug": "freshstart", "verticals": ["karate"]},
            format="json",
        )
        self.assertEqual(response.status_code, 201)

        organization = Organization.objects.get(slug="freshstart")
        academy = organization.academies.get()
        self.assertEqual(academy.verticals, ["karate"])
        self.assertEqual(
            Membership.objects.get(organization=organization, user_id="newbie-1").role,
            Role.OWNER,
        )

    def test_a_taken_subdomain_is_refused(self):
        from .base import make_user

        stranger = make_user("newbie-2", "newbie2@example.com")
        response = self.client_for(stranger).post(
            "/api/organizations/signup/",
            {"name": "Clash", "slug": "irontemple", "verticals": ["gym"]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)


class ApiKeysBelongToTheOrganizationTests(TenantAPITestCase):
    def test_a_key_reaches_every_academy_in_its_organization(self):
        from rest_framework.test import APIClient

        from organizations.models import APIKey

        second = Academy.objects.create(
            organization=self.org.organization,
            name="Aqua Wing", slug="aqua", verticals=["swimming"],
        )
        Student.objects.create(
            academy=second, full_name="Swimmer", joined_on=date(2026, 1, 1)
        )

        _, raw = APIKey.generate(self.org.organization, name="their app")
        client = APIClient(HTTP_HOST=f"{self.org.organization.slug}.{BASE_DOMAIN}")
        client.credentials(HTTP_X_API_KEY=raw, HTTP_X_ACADEMY=second.slug)

        response = client.get("/api/students/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)

    def test_a_key_answers_for_its_own_organization_whatever_host_is_used(self):
        """The key names the tenant, so pointing it at another organization's
        host doesn't reach that organization — it still answers for its own."""
        from rest_framework.test import APIClient

        from organizations.models import APIKey

        Student.objects.create(
            academy=self.org, full_name="Ours", joined_on=date(2026, 1, 1)
        )
        Student.objects.create(
            academy=self.other_org, full_name="Theirs", joined_on=date(2026, 1, 1)
        )

        _, raw = APIKey.generate(self.org.organization, name="their app")
        client = APIClient(HTTP_HOST=f"{self.other_org.organization.slug}.{BASE_DOMAIN}")
        client.credentials(HTTP_X_API_KEY=raw)

        response = client.get("/api/students/")
        self.assertEqual(
            [row["full_name"] for row in response.data["results"]], ["Ours"]
        )
