"""Invitations, and the two rules that stop an academy locking itself out."""

from organizations.constants import Role
from organizations.invitations import claim_pending_memberships
from organizations.models import Membership

from .base import TenantAPITestCase, make_user


class InvitationTests(TenantAPITestCase):
    def invite(self, email, role=Role.MANAGER):
        return self.client_for(self.owner).post(
            "/api/organizations/current/team/", {"email": email, "role": role}, format="json"
        )

    def test_invite_creates_a_membership_with_no_user_yet(self):
        response = self.invite("coach@example.com")
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data["is_pending"])

        membership = Membership.objects.get(email="coach@example.com")
        self.assertEqual(membership.user_id, "")
        self.assertIsNone(membership.joined_at)

    def test_invited_person_gets_in_on_first_request(self):
        self.invite("coach@example.com")

        newcomer = make_user("coach-uuid", "coach@example.com", email_verified=True)
        response = self.client_for(newcomer).get("/api/organizations/current/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["role"], Role.MANAGER)

        membership = Membership.objects.get(email="coach@example.com")
        self.assertEqual(membership.user_id, "coach-uuid")
        self.assertIsNotNone(membership.joined_at)

    def test_unverified_email_cannot_claim_an_invitation(self):
        """Otherwise anyone could sign up using an invited address and take
        that role — the whole invite flow would be an escalation path."""
        self.invite("coach@example.com", Role.OWNER)

        impostor = make_user("impostor", "coach@example.com", email_verified=False)
        self.assertEqual(claim_pending_memberships(impostor), 0)

        response = self.client_for(impostor).get("/api/organizations/current/")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(Membership.objects.get(email="coach@example.com").user_id, "")

    def test_claiming_is_case_insensitive_but_still_exact(self):
        self.invite("Coach@Example.com")
        joiner = make_user("coach-uuid", "coach@example.com")
        self.assertEqual(claim_pending_memberships(joiner), 1)

    def test_claiming_is_idempotent(self):
        self.invite("coach@example.com")
        joiner = make_user("coach-uuid", "coach@example.com")
        self.assertEqual(claim_pending_memberships(joiner), 1)
        self.assertEqual(claim_pending_memberships(joiner), 0)

    def test_an_invitation_does_not_grant_other_organizations(self):
        self.invite("coach@example.com")
        joiner = make_user("coach-uuid", "coach@example.com")
        self.client_for(joiner).get("/api/organizations/current/")

        response = self.client_for(joiner, self.other_org).get("/api/organizations/current/")
        self.assertEqual(response.status_code, 403)

    def test_cannot_invite_the_same_person_twice(self):
        self.assertEqual(self.invite("coach@example.com").status_code, 201)
        self.assertEqual(self.invite("coach@example.com").status_code, 400)


class LastOwnerTests(TenantAPITestCase):
    def owner_membership(self):
        # By user id, not by role: after a promotion there are two owners.
        return Membership.objects.get(organization=self.org.organization, user_id=self.owner.id)

    def test_cannot_demote_the_only_owner(self):
        membership = self.owner_membership()
        response = self.client_for(self.owner).patch(
            f"/api/organizations/current/team/{membership.id}/",
            {"role": Role.MANAGER}, format="json",
        )
        self.assertEqual(response.status_code, 400)
        membership.refresh_from_db()
        self.assertEqual(membership.role, Role.OWNER)

    def test_cannot_remove_the_only_owner(self):
        membership = self.owner_membership()
        response = self.client_for(self.owner).delete(
            f"/api/organizations/current/team/{membership.id}/"
        )
        self.assertEqual(response.status_code, 400)
        self.assertTrue(Membership.objects.filter(pk=membership.pk).exists())

    def test_can_step_down_once_someone_else_owns_it(self):
        other = Membership.objects.get(organization=self.org.organization, user_id=self.manager.id)
        promote = self.client_for(self.owner).patch(
            f"/api/organizations/current/team/{other.id}/",
            {"role": Role.OWNER}, format="json",
        )
        self.assertEqual(promote.status_code, 200)

        demote = self.client_for(self.owner).patch(
            f"/api/organizations/current/team/{self.owner_membership().id}/",
            {"role": Role.MANAGER}, format="json",
        )
        self.assertEqual(demote.status_code, 200)
        self.assertEqual(Membership.objects.filter(organization=self.org.organization, role=Role.OWNER).count(), 1)
