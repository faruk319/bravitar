from django.db import models

from organizations.models import Branch, Organization
from students.models import Student

from .constants import EnquirySource, EnquiryStatus


class Enquiry(models.Model):
    """A prospective student, tracked from first contact to enrolment.

    The leak this exists to close: someone walks in, asks about fees, and is
    never followed up because nobody wrote it down.
    """

    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="enquiries")
    branch = models.ForeignKey(
        Branch, on_delete=models.SET_NULL, related_name="enquiries", null=True, blank=True
    )

    name = models.CharField(max_length=255)
    phone = models.CharField(max_length=32, blank=True)
    email = models.EmailField(blank=True)

    source = models.CharField(max_length=20, choices=EnquirySource.CHOICES, default=EnquirySource.WALK_IN)
    interested_in = models.CharField(
        max_length=50, blank=True, help_text="Vertical or programme they asked about."
    )
    status = models.CharField(max_length=20, choices=EnquiryStatus.CHOICES, default=EnquiryStatus.NEW)

    trial_on = models.DateField(null=True, blank=True)
    follow_up_on = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)

    converted_student = models.OneToOneField(
        Student, on_delete=models.SET_NULL, related_name="from_enquiry", null=True, blank=True
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        verbose_name_plural = "enquiries"

    def __str__(self):
        return f"{self.name} ({self.status})"
