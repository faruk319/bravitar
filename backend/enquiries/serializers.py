from rest_framework import serializers

from .models import Enquiry


class EnquirySerializer(serializers.ModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True, default=None)
    converted_student_name = serializers.CharField(
        source="converted_student.full_name", read_only=True, default=None
    )

    class Meta:
        model = Enquiry
        fields = [
            "id", "name", "phone", "email", "source", "interested_in", "status",
            "trial_on", "follow_up_on", "notes", "branch", "branch_name",
            "converted_student", "converted_student_name", "created_at",
        ]
        read_only_fields = [
            "id", "branch_name", "converted_student", "converted_student_name", "created_at",
        ]

    def validate_branch(self, value):
        if value and value.organization_id != self.context["organization"].id:
            raise serializers.ValidationError("That branch belongs to another organization.")
        return value
