from rest_framework import serializers

from students.models import Student

from .models import AttendanceRecord, BiometricEnrolment, CheckIn


class AttendanceRecordSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)

    class Meta:
        model = AttendanceRecord
        fields = [
            "id", "batch", "student", "student_name", "date", "status", "note", "marked_by",
        ]
        read_only_fields = ["id", "student_name", "marked_by"]


class MarkAttendanceSerializer(serializers.Serializer):
    """Marks a whole register in one request — that's how a coach actually
    works, rather than one POST per student."""

    batch = serializers.IntegerField()
    date = serializers.DateField()
    marks = serializers.ListField(child=serializers.DictField(), allow_empty=False)

    def validate_marks(self, value):
        from .models import AttendanceStatus

        for mark in value:
            if "student" not in mark or "status" not in mark:
                raise serializers.ValidationError("Each mark needs a student and a status.")
            if mark["status"] not in AttendanceStatus.VALUES:
                raise serializers.ValidationError(f"Unknown status: {mark['status']}")
        return value


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
    """What a scanner posts: the pass token, and which device read it."""

    token = serializers.UUIDField()
    device = serializers.CharField(max_length=64, required=False, allow_blank=True)
    branch = serializers.IntegerField(required=False, allow_null=True)

    def validate_token(self, value):
        organization = self.context["organization"]
        student = Student.objects.filter(
            organization=organization, qr_token=value
        ).first()
        if student is None:
            # Same answer for malformed, foreign and reissued tokens — the door
            # is not a way to probe for valid passes.
            raise serializers.ValidationError("That pass isn't recognised.")
        self.context["student"] = student
        return value


class MemberPassSerializer(serializers.ModelSerializer):
    """One member at a time — a list of tokens would be a list of keys."""

    class Meta:
        model = Student
        fields = ["id", "full_name", "qr_token"]
        read_only_fields = fields


class BiometricEnrolmentSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)

    class Meta:
        model = BiometricEnrolment
        fields = ["id", "student", "student_name", "device", "external_id", "created_at"]
        read_only_fields = ["id", "student_name", "created_at"]

    def validate_student(self, value):
        if value.organization_id != self.context["organization"].id:
            raise serializers.ValidationError("That member belongs to another organization.")
        return value

    def validate(self, attrs):
        taken = BiometricEnrolment.objects.filter(
            organization=self.context["organization"],
            device=attrs["device"], external_id=attrs["external_id"],
        ).exclude(pk=getattr(self.instance, "pk", None)).first()
        if taken:
            raise serializers.ValidationError(
                {"external_id": (
                    f"{taken.device} #{taken.external_id} is already "
                    f"{taken.student.full_name}."
                )}
            )
        return attrs


class DevicePunchSerializer(serializers.Serializer):
    """What a biometric reader pushes: its own user number, and when."""

    device = serializers.CharField(max_length=64)
    external_id = serializers.CharField(max_length=64)
    at = serializers.DateTimeField(required=False)

    def validate(self, attrs):
        enrolment = BiometricEnrolment.objects.filter(
            organization=self.context["organization"],
            device=attrs["device"], external_id=attrs["external_id"],
        ).select_related("student").first()
        if enrolment is None:
            # Same answer for an unknown device and an unenrolled id — a reader
            # is not a way to probe who exists.
            raise serializers.ValidationError("That reader id isn't enrolled.")
        self.context["student"] = enrolment.student
        return attrs
