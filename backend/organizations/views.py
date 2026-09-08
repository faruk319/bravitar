from django.db import transaction
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from tenants.context import get_current_organization
from tenants.exceptions import OrganizationNotFound
from tenants.permissions import (
    IsOrganizationMember,
    IsOrganizationOwner,
    IsOrganizationStaff,
    IsPerson,
)

from .constants import Role
from .invitations import claim_pending_memberships
from .models import APIKey, Branch, Membership
from .serializers import (
    APIKeySerializer,
    BranchSerializer,
    MembershipSerializer,
    OrganizationSerializer,
    OrganizationSettingsSerializer,
    OrganizationSignupSerializer,
    TeamMemberSerializer,
    other_owners,
)


class OrganizationSignupView(APIView):
    """An authenticated (but not-yet-onboarded) Supabase user creates an
    Academy, selecting their vertical(s), and becomes its owner."""

    permission_classes = [permissions.IsAuthenticated]

    @transaction.atomic
    def post(self, request):
        serializer = OrganizationSignupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        academy = serializer.save()

        Membership.objects.create(
            academy=academy,
            user_id=request.user.id,
            email=request.user.email,
            role=Role.OWNER,
            joined_at=timezone.now(),
        )

        return Response(OrganizationSerializer(academy).data, status=status.HTTP_201_CREATED)


class MyOrganizationsView(generics.ListAPIView):
    """Organizations the current Supabase user belongs to, with their role."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = MembershipSerializer

    def get_queryset(self):
        # The moment someone signs in we find out which invitations were
        # waiting for them, so an invited coach lands straight in the academy.
        claim_pending_memberships(self.request.user)
        # Only academies this person can actually open — listing one they'd be
        # refused from is worse than showing none.
        return Membership.objects.filter(
            user_id=self.request.user.id, role__in=Role.CAN_SIGN_IN
        ).select_related("academy")


class CurrentOrganizationView(APIView):
    """The Academy resolved for this request by TenantResolutionMiddleware.

    The response carries the caller's own role, so the frontend can hide what
    they can't do — the backend still enforces it either way.
    """

    def get_permissions(self):
        if self.request.method in ("PATCH", "PUT"):
            return [IsOrganizationOwner()]
        return [IsOrganizationMember()]

    def get(self, request):
        academy = get_current_organization(request)
        if academy is None:
            raise OrganizationNotFound()
        data = OrganizationSerializer(academy).data
        data["role"] = request.membership.role
        return Response(data)

    def patch(self, request):
        academy = get_current_organization(request)
        if academy is None:
            raise OrganizationNotFound()

        serializer = OrganizationSettingsSerializer(academy, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        data = OrganizationSerializer(academy).data
        data["role"] = request.membership.role
        return Response(data)


class TeamListCreateView(generics.ListCreateAPIView):
    """The academy's team. Staff and up can see who is on it; only an owner
    changes it.

    Reading it needs a person, not just an API key: the list is everyone's
    email address, and a leaked key should not hand over the roster of who
    can get in.
    """

    serializer_class = TeamMemberSerializer

    def get_permissions(self):
        if self.request.method == "POST":
            return [IsOrganizationOwner()]
        return [IsOrganizationStaff(), IsPerson()]

    def get_serializer_context(self):
        return {**super().get_serializer_context(),
                "academy": get_current_organization(self.request)}

    def get_queryset(self):
        return Membership.objects.filter(
            academy=get_current_organization(self.request)
        ).prefetch_related("branches")

    def perform_create(self, serializer):
        """Invites by email. The row exists before the person does — user_id
        is filled in when they first sign in."""
        serializer.save(academy=get_current_organization(self.request), user_id="")


class TeamMemberDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = TeamMemberSerializer

    def get_permissions(self):
        if self.request.method == "GET":
            return [IsOrganizationStaff(), IsPerson()]
        return [IsOrganizationOwner()]

    def get_serializer_context(self):
        return {**super().get_serializer_context(),
                "academy": get_current_organization(self.request)}

    def get_queryset(self):
        return Membership.objects.filter(
            academy=get_current_organization(self.request)
        ).prefetch_related("branches")

    def perform_destroy(self, instance):
        if instance.role == Role.OWNER and other_owners(instance).count() == 0:
            raise ValidationError(
                {"detail": "This is the only owner — promote someone else before removing them."}
            )
        instance.delete()


class BranchListCreateView(generics.ListCreateAPIView):
    serializer_class = BranchSerializer

    def get_permissions(self):
        if self.request.method == "POST":
            return [IsOrganizationOwner()]
        return [IsOrganizationMember()]

    def get_queryset(self):
        return Branch.objects.filter(academy=get_current_organization(self.request))

    def perform_create(self, serializer):
        serializer.save(academy=get_current_organization(self.request))


class BranchDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = BranchSerializer

    def get_permissions(self):
        return [IsOrganizationMember()] if self.request.method == "GET" else [IsOrganizationOwner()]

    def get_queryset(self):
        return Branch.objects.filter(academy=get_current_organization(self.request))

    def perform_destroy(self, instance):
        """Students and batches point at a branch with SET_NULL, so deleting
        one would quietly strand them. Refuse and say how many, rather than
        silently unfiling people."""
        students = instance.students.count()
        batches = instance.batches.count()
        if students or batches:
            raise ValidationError({"detail": (
                f"{instance.name} still has {students} member(s) and {batches} batch(es). "
                "Move them to another branch first."
            )})
        instance.delete()


class APIKeyListCreateView(generics.ListCreateAPIView):
    serializer_class = APIKeySerializer
    permission_classes = [IsOrganizationOwner]

    def get_queryset(self):
        return APIKey.objects.filter(academy=get_current_organization(self.request))

    def create(self, request, *args, **kwargs):
        academy = get_current_organization(request)
        api_key, raw_key = APIKey.generate(academy, name=request.data.get("name", ""))
        data = APIKeySerializer(api_key).data
        data["key"] = raw_key  # only ever returned once
        return Response(data, status=status.HTTP_201_CREATED)


class APIKeyRevokeView(APIView):
    """Stops a key working, permanently.

    One-way on purpose: a key is revoked because it leaked, and being able to
    switch it back on would undo exactly the thing revoking was for. The row
    stays so the key remains accounted for — when it was made, when it was
    last used — rather than vanishing from the record.
    """

    permission_classes = [IsOrganizationOwner]

    def post(self, request, pk):
        academy = get_current_organization(request)
        try:
            api_key = APIKey.objects.get(pk=pk, academy=academy)
        except APIKey.DoesNotExist:
            return Response({"detail": "API key not found."}, status=status.HTTP_404_NOT_FOUND)

        if not api_key.is_active:
            return Response(
                {"detail": "That key was already revoked."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        api_key.is_active = False
        api_key.save(update_fields=["is_active"])
        return Response(APIKeySerializer(api_key).data)
