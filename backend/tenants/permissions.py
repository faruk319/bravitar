from rest_framework.permissions import BasePermission

from organizations.constants import Role
from organizations.models import Membership

from .context import get_current_organization


class IsOrganizationMember(BasePermission):
    """Request must be scoped to an Organization (via subdomain, custom
    domain, or API key) and the authenticated user must belong to it."""

    message = "You are not a member of this organization."

    def has_permission(self, request, view):
        organization = get_current_organization(request)
        if organization is None or not getattr(request.user, "is_authenticated", False):
            return False

        membership = Membership.objects.filter(
            organization=organization, user_id=request.user.id
        ).first()
        if membership is None:
            return False

        request.membership = membership
        return True


class IsOrganizationStaff(IsOrganizationMember):
    """Owners and staff/trainers — the people who run the academy, as opposed
    to the members who attend it."""

    message = "Only owners and staff can do this."

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        return request.membership.role in (Role.OWNER, Role.STAFF)


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

    @property
    def message(self):
        return f"This organization does not have the '{self.vertical}' module enabled."

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        organization = get_current_organization(request)
        return self.vertical in (organization.verticals or [])
