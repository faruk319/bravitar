from django.db import transaction
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from tenants.context import get_current_organization
from tenants.exceptions import OrganizationNotFound
from tenants.permissions import IsOrganizationMember, IsOrganizationOwner

from .constants import Role
from .models import APIKey, Branch, Membership
from .serializers import (
    APIKeySerializer,
    BranchSerializer,
    MembershipSerializer,
    OrganizationSerializer,
    OrganizationSignupSerializer,
)


class OrganizationSignupView(APIView):
    """An authenticated (but not-yet-onboarded) Supabase user creates an
    Organization, selecting their vertical(s), and becomes its owner."""

    permission_classes = [permissions.IsAuthenticated]

    @transaction.atomic
    def post(self, request):
        serializer = OrganizationSignupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        organization = serializer.save()

        Membership.objects.create(
            organization=organization,
            user_id=request.user.id,
            email=request.user.email,
            role=Role.OWNER,
        )

        return Response(OrganizationSerializer(organization).data, status=status.HTTP_201_CREATED)


class MyOrganizationsView(generics.ListAPIView):
    """Organizations the current Supabase user belongs to, with their role."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = MembershipSerializer

    def get_queryset(self):
        return Membership.objects.filter(user_id=self.request.user.id).select_related("organization")


class CurrentOrganizationView(APIView):
    """The Organization resolved for this request by TenantResolutionMiddleware."""

    permission_classes = [IsOrganizationMember]

    def get(self, request):
        organization = get_current_organization(request)
        if organization is None:
            raise OrganizationNotFound()
        return Response(OrganizationSerializer(organization).data)


class BranchListCreateView(generics.ListCreateAPIView):
    serializer_class = BranchSerializer

    def get_permissions(self):
        if self.request.method == "POST":
            return [IsOrganizationOwner()]
        return [IsOrganizationMember()]

    def get_queryset(self):
        return Branch.objects.filter(organization=get_current_organization(self.request))

    def perform_create(self, serializer):
        serializer.save(organization=get_current_organization(self.request))


class APIKeyListCreateView(generics.ListCreateAPIView):
    serializer_class = APIKeySerializer
    permission_classes = [IsOrganizationOwner]

    def get_queryset(self):
        return APIKey.objects.filter(organization=get_current_organization(self.request))

    def create(self, request, *args, **kwargs):
        organization = get_current_organization(request)
        api_key, raw_key = APIKey.generate(organization, name=request.data.get("name", ""))
        data = APIKeySerializer(api_key).data
        data["key"] = raw_key  # only ever returned once
        return Response(data, status=status.HTTP_201_CREATED)
