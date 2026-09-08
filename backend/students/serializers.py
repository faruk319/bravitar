from rest_framework import serializers

from .constants import DocumentKind
from .models import MemberDocument, Student
from .uploads import validate_document, validate_photo


class StudentSerializer(serializers.ModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True, default=None)
    has_photo = serializers.SerializerMethodField()
    document_count = serializers.SerializerMethodField()

    class Meta:
        model = Student
        fields = [
            "id", "full_name", "phone", "email", "date_of_birth",
            "guardian_name", "guardian_phone", "status", "joined_on",
            "notes", "branch", "branch_name", "user_id",
            "has_photo", "document_count",
        ]

        read_only_fields = ["id", "branch_name", "has_photo", "document_count"]

    def get_has_photo(self, obj):
        return bool(obj.photo)

    def get_document_count(self, obj):
        
        return getattr(obj, "document_total", None) or obj.documents.count()

    def validate(self, attrs):
        """A member with no branch named lands in the primary one, so a
        multi-branch academy doesn't collect unfiled people."""
        if self.instance is None and not attrs.get("branch"):
            from organizations.models import Branch

            attrs["branch"] = Branch.objects.filter(
                organization=self.context["organization"], is_primary=True
            ).first()
        return attrs

    def validate_branch(self, value):
        if value and value.organization_id != self.context["organization"].id:
            raise serializers.ValidationError("That branch belongs to another organization.")
        allowed = self.context.get("allowed_branches")
        if value and allowed is not None and value.id not in allowed:
            raise serializers.ValidationError("You don't work at that branch.")
        return value


class MemberPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Student
        fields = ["photo"]

    def to_internal_value(self, data):
        
        upload = data.get("photo")
        if upload is not None and hasattr(upload, "size"):
            try:
                validate_photo(upload)
            except serializers.ValidationError as error:
                raise serializers.ValidationError({"photo": error.detail}) from error
        return super().to_internal_value(data)


class MemberDocumentSerializer(serializers.ModelSerializer):
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    is_verified = serializers.BooleanField(read_only=True)
    
    number_last4 = serializers.CharField(required=False, allow_blank=True, max_length=32)

    class Meta:
        model = MemberDocument
        fields = [
            "id", "student", "kind", "kind_label", "number_last4",
            "verified_on", "verified_by", "is_verified", "created_at",
            "uploaded_by", "file",
        ]
        read_only_fields = [
            "id", "kind_label", "is_verified", "created_at", "uploaded_by",
            "verified_by",
        ]
    
        extra_kwargs = {"file": {"write_only": True}}

    def validate_file(self, value):
        validate_document(value)
        return value

    def validate_student(self, value):
        if value.organization_id != self.context["organization"].id:
            raise serializers.ValidationError("That member belongs to another organization.")
        return value

    def validate_number_last4(self, value):
        """Only the last four digits are storable, and this is where somebody
        pasting a whole Aadhaar number gets stopped."""
        value = value.strip()
        if not value:
            return value
        if not value.isdigit():
            raise serializers.ValidationError("Digits only.")
        if len(value) != 4:
            raise serializers.ValidationError(
                "Last four digits only — the full number is not stored, on purpose."
            )
        return value

    def validate(self, attrs):
        kind = attrs.get("kind", getattr(self.instance, "kind", None))
        student = attrs.get("student") or getattr(self.instance, "student", None)

        if kind and student and self.instance is None:
            if MemberDocument.objects.filter(student=student, kind=kind).exists():
                label = dict(DocumentKind.CHOICES)[kind]
                raise serializers.ValidationError(
                    {"kind": (
                        f"{student.full_name} already has a {label} on file. "
                        "Delete that one first if this replaces it."
                    )}
                )
        return attrs
