"""Shared harness for the API tests.

Authentication is forced rather than driven through a real Supabase token:
the JWT path has its own tests, and everything else is about what a *known*
identity is allowed to do. Tenancy still goes through the real middleware, so
every request here resolves its academy from the Host header exactly as
production does.
"""

from django.test import override_settings
from rest_framework.test import APIClient, APITestCase

from accounts.authentication import SupabaseUser
from organizations.constants import Role
from organizations.models import Membership, Academy

BASE_DOMAIN = "testserver"


def make_user(user_id, email="person@example.com", email_verified=True):
    return SupabaseUser({
        "sub": user_id,
        "email": email,
        "user_metadata": {"email_verified": email_verified},
    })


@override_settings(ALLOWED_HOSTS=["*"], BASE_DOMAIN=BASE_DOMAIN)
class TenantAPITestCase(APITestCase):
    """Base class giving each test two organizations, so "does this leak?"
    is always answerable rather than assumed."""

    def setUp(self):
        super().setUp()
        # A gym almost always wants both: the business side and the
        # training side. They are separate verticals so either can stand
        # alone, which test_verticals covers.
        self.org = Academy.objects.create(
            name="Iron Temple", slug="irontemple", verticals=["gym", "fitness"]
        )
        self.other_org = Academy.objects.create(
            name="Blue Wave", slug="bluewave", verticals=["swimming"]
        )

        self.owner = self.add_member(self.org, "owner-1", "owner@example.com", Role.OWNER)
        self.manager = self.add_member(self.org, "manager-1", "manager@example.com", Role.MANAGER)
        # Staff and member are wired but switched off. Both rows exist
        # precisely to prove they grant nothing while that is the case.
        self.staff = self.add_member(self.org, "staff-1", "staff@example.com", Role.STAFF)
        self.member = self.add_member(self.org, "member-1", "member@example.com", Role.MEMBER)
        self.outsider = make_user("outsider-1", "outsider@example.com")

        self.other_owner = self.add_member(
            self.other_org, "owner-2", "owner2@example.com", Role.OWNER
        )

    def add_member(self, academy, user_id, email, role):
        Membership.objects.create(
            academy=academy, user_id=user_id, email=email, role=role
        )
        return make_user(user_id, email)

    def client_for(self, user, academy=None):
        """A client whose Host resolves to `academy` and who is signed in
        as `user`. Defaults to the primary academy."""
        academy = academy or self.org
        client = APIClient(HTTP_HOST=f"{academy.slug}.{BASE_DOMAIN}")
        if user is not None:
            client.force_authenticate(user=user)
        return client
