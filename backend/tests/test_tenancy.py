"""Tenant resolution: which organization a request belongs to.

Everything else in the platform is scoped by the answer, so getting this
wrong leaks one academy's data into another's screens.
"""

from django.test import override_settings

from organizations.models import APIKey

from .base import BASE_DOMAIN, TenantAPITestCase


class SubdomainResolutionTests(TenantAPITestCase):
    def test_subdomain_selects_the_organization(self):
        response = self.client_for(self.owner).get("/api/organizations/current/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["slug"], "irontemple")

    def test_the_same_user_on_another_subdomain_is_not_a_member(self):
        response = self.client_for(self.owner, self.other_org).get(
            "/api/organizations/current/"
        )
        self.assertEqual(response.status_code, 403)

    def test_root_domain_resolves_no_tenant(self):
        client = self.client_for(self.owner)
        client.defaults["HTTP_HOST"] = BASE_DOMAIN
        self.assertEqual(client.get("/api/organizations/current/").status_code, 403)

    def test_unknown_subdomain_resolves_no_tenant(self):
        client = self.client_for(self.owner)
        client.defaults["HTTP_HOST"] = f"nosuchacademy.{BASE_DOMAIN}"
        self.assertEqual(client.get("/api/organizations/current/").status_code, 403)


class CustomDomainResolutionTests(TenantAPITestCase):
    def test_unverified_custom_domain_does_not_resolve(self):
        """A domain someone merely typed in must not route to them until it is
        verified, or one academy could claim another's hostname."""
        self.org.custom_domain = "gym.example.com"
        self.org.domain_verified = False
        self.org.save()

        client = self.client_for(self.owner)
        client.defaults["HTTP_HOST"] = "gym.example.com"
        self.assertEqual(client.get("/api/organizations/current/").status_code, 403)

    def test_verified_custom_domain_resolves(self):
        self.org.custom_domain = "gym.example.com"
        self.org.domain_verified = True
        self.org.save()

        client = self.client_for(self.owner)
        client.defaults["HTTP_HOST"] = "gym.example.com"
        response = client.get("/api/organizations/current/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["slug"], "irontemple")


class APIKeyResolutionTests(TenantAPITestCase):
    def test_api_key_scopes_the_request_to_its_own_organization(self):
        _, raw_key = APIKey.generate(self.other_org, name="theirs")

        # Host says irontemple, but the key belongs to bluewave — the key wins,
        # and the irontemple owner is therefore not a member of the result.
        client = self.client_for(self.owner)
        response = client.get("/api/organizations/current/", HTTP_X_API_KEY=raw_key)
        self.assertEqual(response.status_code, 403)

    def test_unknown_api_key_resolves_no_tenant(self):
        client = self.client_for(self.owner)
        response = client.get("/api/organizations/current/", HTTP_X_API_KEY="bvt_nonsense")
        self.assertEqual(response.status_code, 403)

    def test_inactive_api_key_resolves_no_tenant(self):
        api_key, raw_key = APIKey.generate(self.org, name="revoked")
        api_key.is_active = False
        api_key.save()

        client = self.client_for(self.owner)
        response = client.get("/api/organizations/current/", HTTP_X_API_KEY=raw_key)
        self.assertEqual(response.status_code, 403)

    def test_raw_key_is_never_stored(self):
        _, raw_key = APIKey.generate(self.org, name="k")
        stored = APIKey.objects.get(organization=self.org)
        self.assertNotEqual(stored.hashed_key, raw_key)
        self.assertNotIn(raw_key, stored.hashed_key)
        # Only a short prefix is kept, for identifying the key in a list.
        self.assertTrue(raw_key.startswith(stored.prefix))
