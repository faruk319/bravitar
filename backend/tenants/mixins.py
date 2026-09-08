from .branches import allowed_branch_ids, restrict
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
        """Writes need staff *on top of* what the view already asks for.
        Returning staff alone silently dropped vertical gates, manager-only and
        IsPerson on every POST."""
        permissions = [permission() for permission in self.permission_classes]
        if self.staff_only_writes and self.request.method not in ("GET", "HEAD", "OPTIONS"):
            permissions.append(IsOrganizationStaff())
        return permissions

    @property
    def allowed_branches(self):
        """Branch ids this caller may work in, or None for no restriction."""
        return allowed_branch_ids(self.request, self.organization)

    def scoped(self, model):
        """Tenant first, then branch. `?branch=` is the caller narrowing what
        they already have; it can't widen it."""
        queryset = restrict(
            model.objects.filter(organization=self.organization),
            model,
            self.allowed_branches,
        )
        branch = self.request.query_params.get("branch")
        if branch and hasattr(model, "branch"):
            queryset = queryset.filter(branch_id=branch)
        return queryset

    def get_serializer_context(self):
        return {
            **super().get_serializer_context(),
            "organization": self.organization,
            # Serializers validate a write's target branch against this;
            # scoping the queryset only stops reads.
            "allowed_branches": self.allowed_branches,
        }

    def perform_create(self, serializer):
        serializer.save(organization=self.organization)
