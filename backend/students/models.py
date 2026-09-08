import uuid

from django.db import models

from organizations.models import Branch, Organization

from .constants import DocumentKind, StudentStatus


def member_photo_path(instance, filename):
    """Unguessable path under an organization's own folder. Nothing here is
    served statically — the only way in is a view that checks the caller."""
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpg"
    return f"member_photos/{instance.organization_id}/{uuid.uuid4().hex}.{extension}"


def member_document_path(instance, filename):
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpg"
    return f"member_documents/{instance.organization_id}/{uuid.uuid4().hex}.{extension}"


class Student(models.Model):
    """A person enrolled at the academy.

    Deliberately separate from Membership: a Membership is a login, a Student
    is an enrolment record. Most students — children especially — never have a
    login, and a parent's login may cover several students. `user_id` links the
    two when the student does sign in.
    """

    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="students")
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

    # The face at the front desk. Unlike a progress photo — which is private
    # to the member — this exists so whoever is on the desk can tell who just
    # walked in, so anyone running the academy may see it.
    photo = models.ImageField(upload_to=member_photo_path, null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["full_name"]

    def __str__(self):
        return self.full_name


class MemberDocument(models.Model):
    """A scan of a member's proof of identity.

    Held to a tighter rule than the rest of the member record: managers and
    owners only, never an API key, and never served statically. A coach taking
    the 6am class has no reason to see anybody's Aadhaar.

    **The full document number is deliberately not storable.** Only the last
    four digits go in `number_last4`, which is all anyone needs to match a
    scan to a person. Keeping whole Aadhaar numbers turns a small academy's
    database into something worth stealing, and there is no feature here that
    needs them.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="member_documents"
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
