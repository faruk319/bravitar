from rest_framework import serializers

from students.models import Student

from .models import Batch, Enrolment


class BatchSerializer(serializers.ModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True, default=None)
    enrolled_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Batch
        fields = [
            "id", "name", "description", "coach_name", "days_of_week",
            "start_time", "end_time", "capacity", "is_active",
            "branch", "branch_name", "enrolled_count",
        ]
        read_only_fields = ["id", "branch_name", "enrolled_count"]

    def validate_days_of_week(self, value):
        if any(not isinstance(day, int) or day < 0 or day > 6 for day in value):
            raise serializers.ValidationError("Days must be integers 0 (Mon) to 6 (Sun).")
        return value

    def validate_branch(self, value):
        if value and value.organization_id != self.context["organization"].id:
            raise serializers.ValidationError("That branch belongs to another organization.")
        return value


class EnrolmentSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    batch_name = serializers.CharField(source="batch.name", read_only=True)

    class Meta:
        model = Enrolment
        fields = [
            "id", "batch", "batch_name", "student", "student_name",
            "enrolled_on", "left_on", "is_active",
        ]
        read_only_fields = ["id", "student_name", "batch_name"]

    def validate(self, attrs):
        organization = self.context["organization"]
        batch = attrs.get("batch") or getattr(self.instance, "batch", None)
        student = attrs.get("student") or getattr(self.instance, "student", None)

        if batch and batch.organization_id != organization.id:
            raise serializers.ValidationError({"batch": "That batch belongs to another organization."})
        if student and student.organization_id != organization.id:
            raise serializers.ValidationError({"student": "That student belongs to another organization."})

        if batch and batch.capacity is not None:
            active = batch.enrolments.filter(is_active=True)
            if self.instance:
                active = active.exclude(pk=self.instance.pk)
            if active.count() >= batch.capacity:
                raise serializers.ValidationError(
                    {"batch": f"{batch.name} is full ({batch.capacity} places)."}
                )
        return attrs
