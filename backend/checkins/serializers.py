from rest_framework import serializers

from students.models import Student

from .models import CheckIn


class CheckInSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True, default=None)
    tier_name = serializers.CharField(
        source="subscription.tier.name", read_only=True, default=None
    )
    refusal_label = serializers.CharField(
        source="get_refused_reason_display", read_only=True, default=""
    )
    is_inside = serializers.BooleanField(read_only=True)
    minutes = serializers.IntegerField(read_only=True)

    class Meta:
        model = CheckIn
        fields = [
            "id", "student", "student_name", "branch", "branch_name",
            "subscription", "tier_name", "checked_in_at", "checked_out_at",
            "method", "admitted", "refused_reason", "refusal_label",
            "device", "is_inside", "minutes",
        ]
        read_only_fields = [
            "id", "student_name", "branch_name", "subscription", "tier_name",
            "admitted", "refused_reason", "refusal_label", "is_inside",
            "minutes", "checked_out_at",
        ]

    def validate_student(self, value):
        if value.organization_id != self.context["organization"].id:
            raise serializers.ValidationError("That member belongs to another organization.")
        return value

    def validate_branch(self, value):
        if value and value.organization_id != self.context["organization"].id:
            raise serializers.ValidationError("That branch belongs to another organization.")
        return value


class ScanSerializer(serializers.Serializer):
    """What a scanner posts: the token off the pass, and optionally which
    device read it."""

    token = serializers.UUIDField()
    device = serializers.CharField(max_length=64, required=False, allow_blank=True)
    branch = serializers.IntegerField(required=False, allow_null=True)

    def validate_token(self, value):
        organization = self.context["organization"]
        student = Student.objects.filter(
            organization=organization, qr_token=value
        ).first()
        if student is None:
            # Deliberately the same answer whether the token is malformed,
            # belongs to another academy, or has been reissued — a scanner at
            # the door should not be a way to probe for valid passes.
            raise serializers.ValidationError("That pass isn't recognised.")
        self.context["student"] = student
        return value


class MemberPassSerializer(serializers.ModelSerializer):
    """The pass itself. Only ever returned for one member at a time — a list
    endpoint handing out every token would be a list of skeleton keys."""

    class Meta:
        model = Student
        fields = ["id", "full_name", "qr_token"]
        read_only_fields = fields
