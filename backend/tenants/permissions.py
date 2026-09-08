from rest_framework.permissions import BasePermission

from organizations.constants import Role
from organizations.models import Membership

from .context import get_current_organization


class IsOrganizationMember(BasePermission):
    """Request must be scoped to an Academy (via subdomain, custom
    domain, or API key) and the authenticated user must belong to it.

    Belonging is not enough on its own: only roles in `Role.CAN_SIGN_IN` may
    use the API. Member sign-in is not switched on yet, so a member-role row
    is preserved but gets no access — enabling it later is a one-line change
    in `Role`, and nobody's link to their academy is lost in the meantime.
    """

    message = "You are not a member of this academy."

    def has_permission(self, request, view):
        academy = get_current_organization(request)
        if academy is None or not getattr(request.user, "is_authenticated", False):
            return False

        if getattr(request.user, "is_api_key", False):
            # A key belongs to one academy and can only ever act for that one,
            # whatever host the request arrived on.
            if request.user.academy_id != academy.id:
                return False
            request.membership = None
            return True

        membership = Membership.objects.filter(
            academy=academy, user_id=request.user.id
        ).first()

        if membership is None:
            # Might be someone arriving on an invitation for the first time.
            # Only on the miss path, so the common case stays one query — and
            # only claims addresses Supabase has confirmed.
            from organizations.invitations import claim_pending_memberships

            if claim_pending_memberships(request.user):
                membership = Membership.objects.filter(
                    academy=academy, user_id=request.user.id
                ).first()

        if membership is None:
            return False

        if membership.role not in Role.CAN_SIGN_IN:
            label = dict(Role.CHOICES).get(membership.role, membership.role)
            self.message = (
                f"{label} sign-in isn't available yet. Ask your academy for an "
                "owner or manager account if you need access."
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
        # An API key acts for the academy, so it can run it — but never
        # administer it; see IsOrganizationOwner.
        if request.membership is None:
            return True
        return request.membership.role in Role.RUNS_SESSIONS


class IsOrganizationManager(IsOrganizationMember):
    """Owners and managers. Used where the academy's money is involved —
    a trainer runs sessions, a manager bills for them."""

    message = "Only owners and managers can do this."

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        if request.membership is None:  # API key, acting for the academy
            return True
        return request.membership.role in Role.MANAGES


class IsOrganizationOwner(IsOrganizationMember):
    """Administering the academy: settings, who has access, and the keys
    themselves. Deliberately closed to API keys — a leaked key must not be
    able to hand out access or mint more keys, which would make revoking the
    one you know about pointless."""

    message = "Only the academy owner can do this."

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        if request.membership is None:
            self.message = "An API key can't administer the academy."
            return False
        return request.membership.role == Role.OWNER


class IsPerson(IsOrganizationMember):
    """For records that belong to one person rather than to the academy — a
    body log, a workout, a food diary. An API key has no person behind it, so
    letting it through would mean writing rows attributed to nobody."""

    message = "This is personal data, so it needs a signed-in person rather than an API key."

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        return request.membership is not None


class RequiresVertical(IsOrganizationMember):
    """Gates a vertical plugin's endpoints to organizations that actually
    selected that vertical. Subclass and set `vertical`; this is what keeps a
    dance academy from reaching the gym plugin's API.
    """

    vertical = None

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False

        academy = get_current_organization(request)
        if self.vertical in (academy.verticals or []):
            return True

        # A plain attribute, not a property: the base class sets `self.message`
        # when it denies, and a read-only property here would break that.
        self.message = (
            f"This academy does not have the '{self.vertical}' module enabled."
        )
        return False
