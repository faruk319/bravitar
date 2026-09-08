from rest_framework import serializers

from .constants import Role, Vertical


def validate_selectable_verticals(value, allowed_extra=frozenset()):
    """Only verticals with a plugin behind them can be chosen."""
    unknown = set(value) - set(Vertical.VALUES)
    if unknown:
        raise serializers.ValidationError(f"Unknown vertical(s): {', '.join(sorted(unknown))}")

    unavailable = set(value) - set(Vertical.IMPLEMENTED) - set(allowed_extra)
    if unavailable:
        raise serializers.ValidationError(
            f"Not available yet: {', '.join(sorted(unavailable))}."
        )
    return list(dict.fromkeys(value))
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
        return validate_selectable_verticals(value)


class MembershipSerializer(serializers.ModelSerializer):
    organization = OrganizationSerializer()

    class Meta:
        model = Membership
        fields = ["organization", "role", "created_at"]


class OrganizationSettingsSerializer(serializers.ModelSerializer):
    """What an owner can change about their academy after signup."""

    verticals = serializers.ListField(child=serializers.CharField(), allow_empty=False)

    class Meta:
        model = Organization
        fields = [
            "id", "name", "slug", "verticals", "plan", "custom_domain",
            "domain_verified", "membership_requires_payment",
        ]
        # The slug is the subdomain every existing link points at, so it isn't
        # editable here; plan and domain_verified are set by billing and the
        # domain-verification flow, not by hand.
        read_only_fields = ["id", "slug", "plan", "custom_domain", "domain_verified"]

    def validate_verticals(self, value):
        # An academy already on a vertical that has since been withdrawn keeps
        # it — it just can't be added to. Stranding them would be worse.
        already_on = set(getattr(self.instance, "verticals", None) or [])
        return validate_selectable_verticals(value, allowed_extra=already_on)


class TeamMemberSerializer(serializers.ModelSerializer):
    """A person on the academy's team, invited or already signed in."""

    is_pending = serializers.BooleanField(read_only=True)

    class Meta:
        model = Membership
        fields = ["id", "email", "role", "is_pending", "created_at", "joined_at"]
        read_only_fields = ["id", "is_pending", "created_at", "joined_at"]

    def validate_email(self, value):
        organization = self.context["organization"]
        existing = Membership.objects.filter(organization=organization, email__iexact=value)
        if self.instance:
            existing = existing.exclude(pk=self.instance.pk)
        if existing.exists():
            raise serializers.ValidationError("That person is already on the team.")
        return value.strip()

    def validate_role(self, value):
        if value not in Role.ASSIGNABLE:
            raise serializers.ValidationError(
                f"Role must be one of: {', '.join(Role.ASSIGNABLE)}."
            )
        return value

    def validate(self, attrs):
        """An organization must keep at least one owner, or nobody can manage
        it — including undoing whatever demotion caused it."""
        new_role = attrs.get("role")
        if self.instance and new_role and self.instance.role == Role.OWNER and new_role != Role.OWNER:
            if other_owners(self.instance).count() == 0:
                raise serializers.ValidationError(
                    {"role": "This is the only owner — promote someone else first."}
                )
        return attrs


def other_owners(membership):
    return Membership.objects.filter(
        organization=membership.organization, role=Role.OWNER
    ).exclude(pk=membership.pk)


class BranchSerializer(serializers.ModelSerializer):
    student_count = serializers.SerializerMethodField()
    batch_count = serializers.SerializerMethodField()

    class Meta:
        model = Branch
        fields = [
            "id", "name", "address", "is_primary", "created_at",
            "student_count", "batch_count",
        ]
        read_only_fields = ["id", "created_at", "student_count", "batch_count"]

    def get_student_count(self, obj):
        return obj.students.count()

    def get_batch_count(self, obj):
        return obj.batches.count()


class APIKeySerializer(serializers.ModelSerializer):
    class Meta:
        model = APIKey
        fields = ["id", "name", "prefix", "is_active", "created_at", "last_used_at"]
        read_only_fields = fields
