from .context import get_current_organization
from .permissions import IsOrganizationMember, IsOrganizationStaff


class OrganizationScopedMixin:
    """Scopes a viewset to the current Organization.

    Unlike the gym plugin's per-user views, the cross-vertical core is
    academy data: any member of the organization can read it, and staff
    manage it. Branch filtering is opt-in via `?branch=<id>`.
    """

    permission_classes = [IsOrganizationMember]
    staff_only_writes = True

    @property
    def organization(self):
        return get_current_organization(self.request)

    def get_permissions(self):
        """Writes need staff *on top of* whatever the view already asks for.

        This used to return `[IsOrganizationStaff()]` alone, which silently
        threw away every other permission the view had declared. A view asking
        for a vertical gate, or for managers, or for a real person rather than
        an API key, got none of it the moment the request was a POST — so ID
        scans were writable by anyone on staff and member photos were writable
        by an integration token. Permissions are a floor, not a replacement.
        """
        permissions = [permission() for permission in self.permission_classes]
        if self.staff_only_writes and self.request.method not in ("GET", "HEAD", "OPTIONS"):
            permissions.append(IsOrganizationStaff())
        return permissions

    def scoped(self, model):
        queryset = model.objects.filter(organization=self.organization)
        branch = self.request.query_params.get("branch")
        if branch and hasattr(model, "branch"):
            queryset = queryset.filter(branch_id=branch)
        return queryset

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "organization": self.organization}

    def perform_create(self, serializer):
        serializer.save(organization=self.organization)
