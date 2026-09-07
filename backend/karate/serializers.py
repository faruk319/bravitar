from rest_framework import serializers

from .constants import GradingResultChoice
from .models import Belt, Bout, Grading, GradingResult


class BeltSerializer(serializers.ModelSerializer):
    class Meta:
        model = Belt
        fields = ["id", "name", "position", "colour"]
        read_only_fields = ["id"]


class GradingResultSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)

    class Meta:
        model = GradingResult
        fields = ["id", "grading", "student", "student_name", "result", "score", "notes"]
        read_only_fields = ["id", "student_name"]

    def validate_student(self, value):
        if value.organization_id != self.context["organization"].id:
            raise serializers.ValidationError("That student belongs to another organization.")
        return value


class GradingSerializer(serializers.ModelSerializer):
    belt_name = serializers.CharField(source="belt.name", read_only=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True, default=None)
    results = GradingResultSerializer(many=True, read_only=True)
    passed_count = serializers.SerializerMethodField()

    class Meta:
        model = Grading
        fields = [
            "id", "belt", "belt_name", "branch", "branch_name",
            "held_on", "examiner", "notes", "results", "passed_count",
        ]
        read_only_fields = ["id", "belt_name", "branch_name", "results", "passed_count"]

    def get_passed_count(self, obj):
        return sum(1 for r in obj.results.all() if r.result == GradingResultChoice.PASS)

    def validate_belt(self, value):
        if value.organization_id != self.context["organization"].id:
            raise serializers.ValidationError("That belt belongs to another organization.")
        return value


class BoutSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)

    class Meta:
        model = Bout
        fields = [
            "id", "student", "student_name", "fought_on", "opponent_name",
            "opponent_student", "result", "points_for", "points_against",
            "event", "notes",
        ]
        read_only_fields = ["id", "student_name"]

    def validate(self, attrs):
        organization = self.context["organization"]
        for field in ("student", "opponent_student"):
            person = attrs.get(field) or getattr(self.instance, field, None)
            if person and person.organization_id != organization.id:
                raise serializers.ValidationError(
                    {field: "That student belongs to another organization."}
                )

        student = attrs.get("student") or getattr(self.instance, "student", None)
        opponent = attrs.get("opponent_student") or getattr(self.instance, "opponent_student", None)
        if student and opponent and student.id == opponent.id:
            raise serializers.ValidationError(
                {"opponent_student": "A student can't spar against themselves."}
            )
        return attrs
