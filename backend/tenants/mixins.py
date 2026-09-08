from rest_framework.exceptions import ValidationError

from .branches import allowed_branch_ids, restrict
from .context import get_current_academy
from .scope import academies_in_scope
from .permissions import IsOrganizationMember, IsOrganizationStaff


class OrganizationScopedMixin:
    """Scopes a viewset to the current Academy.

    Unlike the gym plugin's per-user views, the cross-vertical core is
    academy data: any member of the academy can read it, and staff
    manage it. Branch filtering is opt-in via `?branch=<id>`.
    """

    permission_classes = [IsOrganizationMember]
    staff_only_writes = True

    @property
    def academy(self):
        return get_current_academy(self.request)

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
        return allowed_branch_ids(self.request, self.academy)

    def scoped(self, model):
        """Academy first, then branch. `?branch=` is the caller narrowing what
        they already have; it can't widen it.

        A model marked BRANCH_VISIBLE_ACROSS is readable from any branch and
        writable only from its own — the desk at one branch has to be able to
        find a member who walked into the wrong one.
        """
        queryset = model.objects.filter(academy__in=academies_in_scope(self.request))
        reading = self.request.method in ("GET", "HEAD", "OPTIONS")
        if not (reading and getattr(model, "BRANCH_VISIBLE_ACROSS", False)):
            queryset = restrict(queryset, model, self.allowed_branches)
        branch = self.request.query_params.get("branch")
        if branch and hasattr(model, "branch"):
            queryset = queryset.filter(branch_id=branch)
        return queryset

    def get_serializer_context(self):
        return {
            **super().get_serializer_context(),
            "academy": self.academy,
            # Serializers validate a write's target branch against this;
            # scoping the queryset only stops reads.
            "allowed_branches": self.allowed_branches,
        }

    def perform_create(self, serializer):
        if self.academy is None:
            raise ValidationError(
                {"detail": "Choose one academy before adding anything — "
                           "\"all academies\" doesn't say where this belongs."}
            )
        serializer.save(academy=self.academy)
