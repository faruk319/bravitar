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
from .models import Academy, APIKey, Branch, Membership, Organization


class OrganizationSerializer(serializers.ModelSerializer):
    """An academy, plus the plan and domain that belong to its organization."""

    plan = serializers.CharField(source="organization.plan", read_only=True)
    custom_domain = serializers.CharField(
        source="organization.custom_domain", read_only=True, default=None
    )
    domain_verified = serializers.BooleanField(
        source="organization.domain_verified", read_only=True, default=False
    )
    organization_slug = serializers.CharField(source="organization.slug", read_only=True)

    class Meta:
        model = Academy
        fields = [
            "id", "name", "slug", "verticals", "plan",
            "custom_domain", "domain_verified", "organization_slug", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class OrganizationSignupSerializer(serializers.ModelSerializer):
    """`name` and `slug` are the organization's; `academy_name` is its first
    academy, defaulting to the same name for the common one-academy case."""

    verticals = serializers.ListField(child=serializers.CharField(), allow_empty=False)
    academy_name = serializers.CharField(required=False, allow_blank=True)
    organization_slug = serializers.CharField(source="organization.slug", read_only=True)

    class Meta:
        model = Academy
        fields = ["id", "name", "slug", "verticals", "academy_name", "organization_slug"]
        read_only_fields = ["id", "organization_slug"]

    def validate_slug(self, value):
        if Organization.objects.filter(slug=value).exists():
            raise serializers.ValidationError("That web address is taken.")
        return value

    def validate_managers(self, value):
        academy = self.context["academy"]
        stray = [m.email for m in value if m.organization_id != academy.organization_id]
        if stray:
            raise serializers.ValidationError("Those people are not on this team.")
        return value

    def create(self, validated_data):
        managers = validated_data.pop("managers", [])
        branch = super().create(validated_data)
        for membership in managers:
            membership.branches.add(branch)
        return branch

    def update(self, instance, validated_data):
        managers = validated_data.pop("managers", None)
        branch = super().update(instance, validated_data)
        if managers is not None:
            branch.team.set(managers)
        return branch

    def validate_verticals(self, value):
        return validate_selectable_verticals(value)

    def create(self, validated_data):
        """Signing up creates the organization and its first academy together.
        The subdomain is the organization's; the academy carries the sports."""
        academy_name = validated_data.pop("academy_name", "") or validated_data["name"]
        organization = Organization.objects.create(
            name=validated_data["name"], slug=validated_data["slug"]
        )
        return Academy.objects.create(
            organization=organization,
            name=academy_name,
            slug=validated_data["slug"],
            verticals=validated_data["verticals"],
        )


class MembershipSerializer(serializers.ModelSerializer):
    """What "Your academies" lists: an organization the caller belongs to, the
    academies inside it, and their role."""

    organization = OrganizationSerializer()
    academies = serializers.SerializerMethodField()

    class Meta:
        model = Membership
        fields = ["organization", "academies", "role", "created_at"]

    def get_academies(self, obj):
        return [
            {"id": a.id, "name": a.name, "slug": a.slug, "verticals": a.verticals}
            for a in obj.organization.academies.all()
        ]


class OrganizationSettingsSerializer(serializers.ModelSerializer):
    plan = serializers.CharField(source="organization.plan", read_only=True)
    custom_domain = serializers.CharField(
        source="organization.custom_domain", read_only=True, default=None
    )
    domain_verified = serializers.BooleanField(
        source="organization.domain_verified", read_only=True, default=False
    )

    """What an owner can change about their academy after signup."""

    verticals = serializers.ListField(child=serializers.CharField(), allow_empty=False)

    class Meta:
        model = Academy
        fields = [
            "id", "name", "slug", "verticals", "plan", "custom_domain",
            "domain_verified", "membership_requires_payment",
        ]
        # The slug is the subdomain every existing link points at, so it isn't
        # editable here; plan and domain_verified are set by billing and the
        # domain-verification flow, not by hand.
        read_only_fields = ["id", "slug", "plan", "custom_domain", "domain_verified"]

    def validate_managers(self, value):
        academy = self.context["academy"]
        stray = [m.email for m in value if m.organization_id != academy.organization_id]
        if stray:
            raise serializers.ValidationError("Those people are not on this team.")
        return value

    def create(self, validated_data):
        managers = validated_data.pop("managers", [])
        branch = super().create(validated_data)
        for membership in managers:
            membership.branches.add(branch)
        return branch

    def update(self, instance, validated_data):
        managers = validated_data.pop("managers", None)
        branch = super().update(instance, validated_data)
        if managers is not None:
            branch.team.set(managers)
        return branch

    def validate_verticals(self, value):
        # An academy already on a vertical that has since been withdrawn keeps
        # it — it just can't be added to. Stranding them would be worse.
        already_on = set(getattr(self.instance, "verticals", None) or [])
        return validate_selectable_verticals(value, allowed_extra=already_on)


class TeamMemberSerializer(serializers.ModelSerializer):
    """A person on the academy's team, invited or already signed in."""

    is_pending = serializers.BooleanField(read_only=True)
    branch_names = serializers.SerializerMethodField()

    class Meta:
        model = Membership
        fields = [
            "id", "email", "role", "is_pending", "created_at", "joined_at",
            "branches", "branch_names",
        ]
        read_only_fields = ["id", "is_pending", "created_at", "joined_at", "branch_names"]

    def get_branch_names(self, obj):
        return [branch.name for branch in obj.branches.all()]

    def validate_branches(self, value):
        academy = self.context["academy"]
        stray = [b.name for b in value if b.academy_id != academy.id]
        if stray:
            raise serializers.ValidationError("Those branches belong to another academy.")
        return value

    def validate_email(self, value):
        academy = self.context["academy"]
        existing = Membership.objects.filter(
            organization=academy.organization, email__iexact=value
        )
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
        """An academy must keep at least one owner, or nobody can manage
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
    offers = serializers.ListField(read_only=True)
    team_count = serializers.SerializerMethodField()
    # Who runs it, set as the branch is created. Write-only because the team
    # roster is where assignments are read and changed from.
    managers = serializers.PrimaryKeyRelatedField(
        many=True, write_only=True, required=False, queryset=Membership.objects.all()
    )
    student_count = serializers.SerializerMethodField()
    batch_count = serializers.SerializerMethodField()

    class Meta:
        model = Branch
        fields = [
            "id", "name", "address", "phone", "email", "is_primary", "created_at",
            "student_count", "batch_count", "team_count", "verticals", "offers",
            "managers",
        ]
        read_only_fields = [
            "id", "created_at", "student_count", "batch_count", "team_count", "offers",
        ]

    def get_student_count(self, obj):
        return obj.students.count()

    def get_batch_count(self, obj):
        return obj.batches.count()

    def validate_managers(self, value):
        academy = self.context["academy"]
        stray = [m.email for m in value if m.organization_id != academy.organization_id]
        if stray:
            raise serializers.ValidationError("Those people are not on this team.")
        return value

    def create(self, validated_data):
        managers = validated_data.pop("managers", [])
        branch = super().create(validated_data)
        for membership in managers:
            membership.branches.add(branch)
        return branch

    def update(self, instance, validated_data):
        managers = validated_data.pop("managers", None)
        branch = super().update(instance, validated_data)
        if managers is not None:
            branch.team.set(managers)
        return branch

    def validate_verticals(self, value):
        """A branch offers a subset of what the academy does — it can't invent
        a sport the academy doesn't run."""
        academy = self.context["academy"]
        stray = [v for v in value if v not in (academy.verticals or [])]
        if stray:
            raise serializers.ValidationError(
                f"This academy doesn't run: {', '.join(stray)}."
            )
        return value

    def get_team_count(self, obj):
        """How many people may work here. Owners aren't counted — they are
        never branch-restricted, so counting them would read as a limit."""
        return obj.team.exclude(role=Role.OWNER).count()


class APIKeySerializer(serializers.ModelSerializer):
    class Meta:
        model = APIKey
        fields = ["id", "name", "prefix", "is_active", "created_at", "last_used_at"]
        read_only_fields = fields
