from django.db import transaction
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.http import Http404
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from tenants.context import get_current_academy, get_current_organization
from tenants.scope import verticals_in_scope
from tenants.exceptions import OrganizationNotFound
from tenants.permissions import (
    IsOrganizationMember,
    IsOrganizationOwner,
    IsOrganizationStaff,
    IsPerson,
)

from .constants import Role
from .invitations import claim_pending_memberships
from .models import APIKey, Branch, BranchAssignment, Membership
from .serializers import (
    BranchAssignmentSerializer,
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
            organization=academy.organization,
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
        ).select_related("organization").prefetch_related("organization__academies")


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
        """The academy in view, or — when the caller is looking at all of them,
        or hasn't picked one — the organization and what it contains, so the
        switcher has something to show."""
        organization = get_current_organization(request)
        academy = get_current_academy(request)

        if academy is None:
            if organization is None:
                raise OrganizationNotFound()

            # "All academies" and "none chosen" both leave no single academy,
            # but they are opposite states: one is a view, the other a prompt.
            looking_at_all = (
                request.headers.get("X-Academy") or ""
            ).strip().lower() == "all"

            payload = {
                "academy": None,
                "viewing": "all" if looking_at_all else "none",
                "role": request.membership.role,
                **self._organization_payload(request, organization),
            }
            if looking_at_all:
                payload.update({
                    "name": organization.name,
                    "slug": organization.slug,
                    "verticals": verticals_in_scope(request),
                })
            return Response(payload)

        data = OrganizationSerializer(academy).data
        data["role"] = request.membership.role
        data["viewing"] = "one"
        data.update(self._organization_payload(request, organization))
        return Response(data)

    def _organization_payload(self, request, organization):
        academies = list(organization.academies.all())
        return {
            "organization": {
                "id": organization.id,
                "name": organization.name,
                "slug": organization.slug,
                "plan": organization.plan,
            },
            "academies": [
                {"id": a.id, "name": a.name, "slug": a.slug, "verticals": a.verticals}
                for a in academies
            ],
            # Only an owner may look at everything at once; a manager working
            # in two would be reading two sets of books on one screen.
            "may_see_all_academies": request.membership.role == Role.OWNER
            and len(academies) > 1,
        }

    def patch(self, request):
        academy = get_current_academy(request)
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
                "academy": get_current_academy(self.request)}

    def get_queryset(self):
        return Membership.objects.filter(
            organization=get_current_organization(self.request)
        ).prefetch_related("branches")

    def perform_create(self, serializer):
        """Invites by email. The row exists before the person does — user_id
        is filled in when they first sign in."""
        serializer.save(
            organization=get_current_organization(self.request), user_id=""
        )


class TeamMemberDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = TeamMemberSerializer

    def get_permissions(self):
        if self.request.method == "GET":
            return [IsOrganizationStaff(), IsPerson()]
        return [IsOrganizationOwner()]

    def get_serializer_context(self):
        return {**super().get_serializer_context(),
                "academy": get_current_academy(self.request)}

    def get_queryset(self):
        return Membership.objects.filter(
            organization=get_current_organization(self.request)
        ).prefetch_related("branches")

    def perform_destroy(self, instance):
        if instance.role == Role.OWNER and other_owners(instance).count() == 0:
            raise ValidationError(
                {"detail": "This is the only owner — promote someone else before removing them."}
            )
        instance.delete()


class BranchListCreateView(generics.ListCreateAPIView):
    serializer_class = BranchSerializer

    def get_serializer_context(self):
        return {**super().get_serializer_context(),
                "academy": get_current_academy(self.request)}

    def get_permissions(self):
        if self.request.method == "POST":
            return [IsOrganizationOwner()]
        return [IsOrganizationMember()]

    def get_queryset(self):
        return Branch.objects.filter(academy=get_current_academy(self.request))

    def perform_create(self, serializer):
        serializer.save(academy=get_current_academy(self.request))


class BranchTeamView(generics.ListCreateAPIView):
    """Who works at one branch, and as what. Adding somebody already on the
    team assigns them; inviting by email creates the membership first."""

    serializer_class = BranchAssignmentSerializer

    def get_permissions(self):
        if self.request.method == "POST":
            return [IsOrganizationOwner()]
        return [IsOrganizationStaff(), IsPerson()]

    def get_serializer_context(self):
        return {**super().get_serializer_context(),
                "academy": get_current_academy(self.request)}

    def branch(self):
        branch = Branch.objects.filter(
            academy=get_current_academy(self.request), pk=self.kwargs["pk"]
        ).first()
        if branch is None:
            raise Http404
        return branch

    def get_queryset(self):
        return BranchAssignment.objects.filter(
            branch=self.branch()
        ).select_related("membership")

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        """Inviting somebody creates their membership, so the role and the
        address are checked before anything is written — a rejected request
        used to leave a stray membership behind."""
        branch = self.branch()
        academy = get_current_academy(request)
        email = (request.data.get("email") or "").strip()
        role = request.data.get("role") or Role.MANAGER

        if role not in Role.PER_BRANCH:
            raise ValidationError(
                {"role": f"Role must be one of: {', '.join(Role.PER_BRANCH)}."}
            )

        if email and not request.data.get("membership"):
            try:
                validate_email(email)
            except DjangoValidationError:
                raise ValidationError({"email": "That isn't an email address."}) from None

            membership, _ = Membership.objects.get_or_create(
                organization=academy.organization, email__iexact=email,
                defaults={"email": email, "role": role, "user_id": ""},
            )
            data = {"membership": membership.id, "role": role}
        else:
            data = {"membership": request.data.get("membership"), "role": role}

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        assignment, _ = BranchAssignment.objects.update_or_create(
            membership=serializer.validated_data["membership"],
            branch=branch,
            defaults={"role": serializer.validated_data["role"]},
        )
        return Response(
            BranchAssignmentSerializer(assignment).data, status=status.HTTP_201_CREATED
        )


class BranchTeamMemberView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = BranchAssignmentSerializer
    permission_classes = [IsOrganizationOwner]

    def get_serializer_context(self):
        return {**super().get_serializer_context(),
                "academy": get_current_academy(self.request)}

    def get_queryset(self):
        return BranchAssignment.objects.filter(
            branch__academy=get_current_academy(self.request)
        ).select_related("membership")


@api_view(["POST"])
@permission_classes([IsOrganizationOwner])
def close_branch(request, pk):
    """Shut a location without losing what happened there.

    Everything filed against it stays; it stops being offered for anything
    new. Members still on it are named, since somebody has to move them.
    """
    academy = get_current_academy(request)
    branch = Branch.objects.filter(academy=academy, pk=pk).first()
    if branch is None:
        return Response({"detail": "No such branch."}, status=status.HTTP_404_NOT_FOUND)

    if branch.is_primary and academy.branches.filter(closed_on__isnull=True).count() > 1:
        return Response(
            {"detail": "This is the main branch. Close the others first."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    branch.closed_on = timezone.localdate()
    branch.save(update_fields=["closed_on"])
    return Response(BranchSerializer(branch, context={"academy": academy}).data)


@api_view(["POST"])
@permission_classes([IsOrganizationOwner])
def reopen_branch(request, pk):
    academy = get_current_academy(request)
    branch = Branch.objects.filter(academy=academy, pk=pk).first()
    if branch is None:
        return Response({"detail": "No such branch."}, status=status.HTTP_404_NOT_FOUND)

    branch.closed_on = None
    branch.save(update_fields=["closed_on"])
    return Response(BranchSerializer(branch, context={"academy": academy}).data)


class BranchDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = BranchSerializer

    def get_serializer_context(self):
        return {**super().get_serializer_context(),
                "academy": get_current_academy(self.request)}

    def get_permissions(self):
        return [IsOrganizationMember()] if self.request.method == "GET" else [IsOrganizationOwner()]

    def get_queryset(self):
        return Branch.objects.filter(academy=get_current_academy(self.request))

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
        return APIKey.objects.filter(
            organization=get_current_organization(self.request)
        )

    def create(self, request, *args, **kwargs):
        academy = get_current_academy(request)
        api_key, raw_key = APIKey.generate(
            academy.organization, name=request.data.get("name", "")
        )
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
        academy = get_current_academy(request)
        try:
            api_key = APIKey.objects.get(pk=pk, organization=academy.organization)
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
