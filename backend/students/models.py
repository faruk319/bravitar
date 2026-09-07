from django.db import models

from organizations.models import Branch, Organization

from .constants import StudentStatus


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

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["full_name"]

    def __str__(self):
        return self.full_name
