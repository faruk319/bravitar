from rest_framework import serializers

from .constants import Vertical
from .models import APIKey, Branch, Membership, Organization


class OrganizationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = [
            "id", "name", "slug", "verticals", "plan",
            "custom_domain", "domain_verified", "created_at",
        ]
        read_only_fields = ["id", "plan", "domain_verified", "created_at"]


class OrganizationSignupSerializer(serializers.ModelSerializer):
    verticals = serializers.ListField(child=serializers.CharField(), allow_empty=False)

    class Meta:
        model = Organization
        fields = ["id", "name", "slug", "verticals"]
        read_only_fields = ["id"]

    def validate_verticals(self, value):
        unknown = set(value) - set(Vertical.VALUES)
        if unknown:
            raise serializers.ValidationError(f"Unknown vertical(s): {', '.join(sorted(unknown))}")
        return value


class MembershipSerializer(serializers.ModelSerializer):
    organization = OrganizationSerializer()

    class Meta:
        model = Membership
        fields = ["organization", "role", "created_at"]


class BranchSerializer(serializers.ModelSerializer):
    class Meta:
        model = Branch
        fields = ["id", "name", "address", "is_primary", "created_at"]
        read_only_fields = ["id", "created_at"]


class APIKeySerializer(serializers.ModelSerializer):
    class Meta:
        model = APIKey
        fields = ["id", "name", "prefix", "is_active", "created_at", "last_used_at"]
        read_only_fields = fields
