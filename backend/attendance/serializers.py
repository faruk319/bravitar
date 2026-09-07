from rest_framework import serializers

from .models import AttendanceRecord


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
