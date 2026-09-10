"""Shared harness for the API tests.

Authentication is forced rather than driven through a real Supabase token:
the JWT path has its own tests, and everything else is about what a *known*
identity is allowed to do. Tenancy still goes through the real middleware, so
every request here resolves its organization from the Host header and its
academy inside that, exactly as production does.
"""

from django.test import override_settings
from rest_framework.test import APIClient, APITestCase

from accounts.authentication import SupabaseUser
from organizations.constants import Role
from organizations.models import Academy, Membership, Organization

BASE_DOMAIN = "testserver"


def make_user(user_id, email="person@example.com", email_verified=True):
    return SupabaseUser({
        "sub": user_id,
        "email": email,
        "user_metadata": {"email_verified": email_verified},
    })


def make_academy(name, slug, verticals):
    """An organization with one academy in it — the common shape, and the one
    the subdomain reaches without anybody naming an academy."""
    organization = Organization.objects.create(name=name, slug=slug)
    return Academy.objects.create(
        organization=organization, name=name, slug=slug, verticals=verticals
    )


@override_settings(ALLOWED_HOSTS=["*"], BASE_DOMAIN=BASE_DOMAIN)
class TenantAPITestCase(APITestCase):
    """Base class giving each test two academies in two organizations, so
    "does this leak?" is always answerable rather than assumed."""

    def setUp(self):
        super().setUp()
        # A gym almost always wants both: the business side and the
        # training side. They are separate verticals so either can stand
        # alone, which test_verticals covers.
        self.org = make_academy("Iron Temple", "irontemple", ["gym", "fitness"])
        self.other_org = make_academy("Blue Wave", "bluewave", ["swimming"])

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
            organization=academy.organization, user_id=user_id, email=email, role=role
        )
        return make_user(user_id, email)

    def as_member(self, user, name="Trainee", academy=None):
        """A Student record for a login.

        Personal fitness records belong to a member, not to an account, so
        anybody who trains here has one — a trainer who lifts at their own
        gym included. Their staff role is a separate thing.
        """
        from datetime import date

        from students.models import Student

        return Student.objects.create(
            academy=academy or self.org, full_name=name,
            joined_on=date(2026, 1, 1), user_id=user.id,
        )

    def client_for(self, user, academy=None):
        """A client whose Host resolves to `academy`'s organization and who is
        signed in as `user`. Defaults to the primary academy."""
        academy = academy or self.org
        client = APIClient(HTTP_HOST=f"{academy.organization.slug}.{BASE_DOMAIN}")
        if user is not None:
            client.force_authenticate(user=user)
        return client
