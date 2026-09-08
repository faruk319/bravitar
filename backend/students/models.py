import uuid

from django.db import models

from organizations.models import Academy, Branch

from .constants import DocumentKind, StudentStatus


def member_photo_path(instance, filename):
    """Unguessable path; never served statically."""
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpg"
    return f"member_photos/{instance.academy_id}/{uuid.uuid4().hex}.{extension}"


def member_document_path(instance, filename):
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpg"
    return f"member_documents/{instance.academy_id}/{uuid.uuid4().hex}.{extension}"


class Student(models.Model):
    """A person enrolled at the academy.

    Deliberately separate from Membership: a Membership is a login, a Student
    is an enrolment record. Most students — children especially — never have a
    login, and a parent's login may cover several students. `user_id` links the
    two when the student does sign in.
    """

    BRANCH_FIELD = "branch"

    academy = models.ForeignKey(Academy, on_delete=models.CASCADE, related_name="students")
    branch = models.ForeignKey(
        Branch, on_delete=models.SET_NULL, related_name="students", null=True, blank=True
    )

    full_name = models.CharField(max_length=255)
    phone = models.CharField(max_length=32, blank=True)
    email = models.EmailField(blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    guardian_name = models.CharField(max_length=255, blank=True)
    guardian_phone = models.CharField(max_length=32, blank=True)

    status = models.CharField(max_length=20, choices=StudentStatus.CHOICES, default=StudentStatus.ACTIVE)
    joined_on = models.DateField()
    notes = models.TextField(blank=True)

    user_id = models.CharField(
        max_length=64, blank=True,
        help_text="Supabase user id, if this student has their own login.",
    )

    # For the front desk, so unlike a progress photo this is not private to
    # the member — anyone running the academy may see it.
    photo = models.ImageField(upload_to=member_photo_path, null=True, blank=True)

    # What the QR pass encodes. Random, not derived from the id, and
    # reissuable when a pass gets photographed.
    qr_token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["full_name"]

    def __str__(self):
        return self.full_name


class MemberDocument(models.Model):
    """A member's proof of identity. Managers and owners only, never an API
    key, never served statically.

    The full number is deliberately not storable — only the last four digits,
    which is all anyone needs to match a scan to a person.
    """

    BRANCH_FIELD = "student__branch"

    academy = models.ForeignKey(
        Academy, on_delete=models.CASCADE, related_name="member_documents"
    )
    student = models.ForeignKey(
        Student, on_delete=models.CASCADE, related_name="documents"
    )

    kind = models.CharField(max_length=20, choices=DocumentKind.CHOICES)
    file = models.FileField(upload_to=member_document_path)
    number_last4 = models.CharField(
        max_length=4, blank=True,
        help_text="Last four digits only. The full number is never stored.",
    )

    uploaded_by = models.CharField(max_length=64, blank=True)
    verified_on = models.DateField(null=True, blank=True)
    verified_by = models.CharField(max_length=64, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.get_kind_display()} for {self.student.full_name}"

    @property
    def is_verified(self):
        return self.verified_on is not None
