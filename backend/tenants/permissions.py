from rest_framework.permissions import BasePermission

from organizations.constants import Role
from organizations.models import Membership

from .context import get_current_organization


class IsOrganizationMember(BasePermission):
    """Request must be scoped to an Organization (via subdomain, custom
    domain, or API key) and the authenticated user must belong to it.

    Belonging is not enough on its own: only roles in `Role.CAN_SIGN_IN` may
    use the API. Member sign-in is not switched on yet, so a member-role row
    is preserved but gets no access — enabling it later is a one-line change
    in `Role`, and nobody's link to their academy is lost in the meantime.
    """

    message = "You are not a member of this organization."

    def has_permission(self, request, view):
        organization = get_current_organization(request)
        if organization is None or not getattr(request.user, "is_authenticated", False):
            return False

        membership = Membership.objects.filter(
            organization=organization, user_id=request.user.id
        ).first()

        if membership is None:
            # Might be someone arriving on an invitation for the first time.
            # Only on the miss path, so the common case stays one query — and
            # only claims addresses Supabase has confirmed.
            from organizations.invitations import claim_pending_memberships

            if claim_pending_memberships(request.user):
                membership = Membership.objects.filter(
                    organization=organization, user_id=request.user.id
                ).first()

        if membership is None:
            return False

        if membership.role not in Role.CAN_SIGN_IN:
            self.message = (
                "Member sign-in isn't available yet. Ask your academy for a "
                "staff account if you need access."
            )
            return False

        request.membership = membership
        return True


class IsOrganizationStaff(IsOrganizationMember):
    """Anyone who runs sessions: owners, managers and trainers."""

    message = "Only owners, managers and staff can do this."

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        return request.membership.role in Role.RUNS_SESSIONS


class IsOrganizationManager(IsOrganizationMember):
    """Owners and managers. Used where the academy's money is involved —
    a trainer runs sessions, a manager bills for them."""

    message = "Only owners and managers can do this."

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        return request.membership.role in Role.MANAGES


class IsOrganizationOwner(IsOrganizationMember):
    message = "Only the organization owner can do this."

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        return request.membership.role == Role.OWNER


class RequiresVertical(IsOrganizationMember):
    """Gates a vertical plugin's endpoints to organizations that actually
    selected that vertical. Subclass and set `vertical`; this is what keeps a
    dance academy from reaching the gym plugin's API.
    """

    vertical = None

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False

        organization = get_current_organization(request)
        if self.vertical in (organization.verticals or []):
            return True

        # A plain attribute, not a property: the base class sets `self.message`
        # when it denies, and a read-only property here would break that.
        self.message = (
            f"This organization does not have the '{self.vertical}' module enabled."
        )
        return False
