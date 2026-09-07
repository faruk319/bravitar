from rest_framework import serializers

from .models import Student


class StudentSerializer(serializers.ModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True, default=None)

    class Meta:
        model = Student
        fields = [
            "id", "full_name", "phone", "email", "date_of_birth",
            "guardian_name", "guardian_phone", "status", "joined_on",
            "notes", "branch", "branch_name", "user_id",
        ]
        read_only_fields = ["id", "branch_name"]

    def validate_branch(self, value):
        if value and value.organization_id != self.context["organization"].id:
            raise serializers.ValidationError("That branch belongs to another organization.")
        return value
