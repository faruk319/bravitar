from django.db import models
from django.utils import timezone

from batches.models import Batch
from organizations.models import Branch, Organization
from students.models import Student

from .admission import Refusal


class CheckInMethod:
    """How they got through the door. `biometric` is unused until a reader is
    plugged in — it posts to the same endpoint the scanner does."""

    QR = "qr"
    MANUAL = "manual"
    BIOMETRIC = "biometric"

    CHOICES = [
        (QR, "QR code"),
        (MANUAL, "Front desk"),
        (BIOMETRIC, "Biometric"),
    ]
    VALUES = [value for value, _ in CHOICES]


class AttendanceStatus:
    PRESENT = "present"
    ABSENT = "absent"
    LATE = "late"
    EXCUSED = "excused"

    CHOICES = [
        (PRESENT, "Present"),
        (ABSENT, "Absent"),
        (LATE, "Late"),
        (EXCUSED, "Excused"),
    ]
    VALUES = [value for value, _ in CHOICES]
    # What counts as having shown up, for attendance-rate maths.
    ATTENDED = [PRESENT, LATE]


class AttendanceRecord(models.Model):
    """One student, one batch, one day — the register a coach marks.

    Separate from CheckIn because this can record an *absence*; a check-in only
    exists when someone actually walked in.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="attendance_records"
    )
    batch = models.ForeignKey(Batch, on_delete=models.CASCADE, related_name="attendance_records")
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="attendance_records")

    date = models.DateField()
    status = models.CharField(max_length=20, choices=AttendanceStatus.CHOICES)
    marked_by = models.CharField(max_length=64, blank=True)
    note = models.CharField(max_length=255, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["batch", "student", "date"], name="one_attendance_mark_per_day"
            )
        ]

    def __str__(self):
        return f"{self.student.full_name} {self.status} on {self.date}"


class CheckIn(models.Model):
    """One visit, or one refused attempt.

    Refusals are rows too — a gym turning people away needs to see that it is.
    Who gets in is decided in `admission.py`.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="checkins"
    )
    student = models.ForeignKey(
        Student, on_delete=models.CASCADE, related_name="checkins"
    )
    branch = models.ForeignKey(
        Branch, on_delete=models.SET_NULL, related_name="checkins", null=True, blank=True
    )
    # Set when a vertical's rule named one; core doesn't require a sale.
    subscription = models.ForeignKey(
        "subscriptions.MemberSubscription", on_delete=models.SET_NULL,
        related_name="checkins", null=True, blank=True,
    )

    checked_in_at = models.DateTimeField(default=timezone.now)
    checked_out_at = models.DateTimeField(null=True, blank=True)

    method = models.CharField(
        max_length=20, choices=CheckInMethod.CHOICES, default=CheckInMethod.MANUAL
    )
    admitted = models.BooleanField(default=True)
    refused_reason = models.CharField(max_length=30, choices=Refusal.CHOICES, blank=True)
    # Free text so a device can name itself without a devices table.
    device = models.CharField(max_length=64, blank=True)

    class Meta:
        ordering = ["-checked_in_at", "-id"]
        indexes = [
            models.Index(fields=["organization", "-checked_in_at"]),
            models.Index(fields=["student", "-checked_in_at"]),
        ]

    def __str__(self):
        return f"{self.student.full_name} at {self.checked_in_at:%Y-%m-%d %H:%M}"

    @property
    def is_inside(self):
        return self.admitted and self.checked_out_at is None

    @property
    def minutes(self):
        if self.checked_out_at is None:
            return None
        return int((self.checked_out_at - self.checked_in_at).total_seconds() // 60)

    def check_out(self, at=None):
        self.checked_out_at = at or timezone.now()
        self.save(update_fields=["checked_out_at"])
        return self

    def mark_register(self):
        """Mark today's batches present. Only fills blanks — a coach who marked
        them excused knows something the turnstile doesn't."""
        if not self.admitted:
            return []

        on = timezone.localdate(self.checked_in_at)
        batches = Batch.objects.filter(
            organization_id=self.organization_id,
            is_active=True,
            enrolments__student_id=self.student_id,
            enrolments__is_active=True,
        ).distinct()

        marked = []
        for batch in batches:
            if on.weekday() not in (batch.days_of_week or []):
                continue
            record, created = AttendanceRecord.objects.get_or_create(
                organization_id=self.organization_id,
                batch=batch,
                student_id=self.student_id,
                date=on,
                defaults={
                    "status": AttendanceStatus.PRESENT,
                    "marked_by": "check-in",
                    "note": "Marked by check-in",
                },
            )
            if created:
                marked.append(record)
        return marked


class BiometricEnrolment(models.Model):
    """Maps a reader's own user number to a member.

    Fingerprint and face templates stay on the device, which does its own
    matching — storing them here would be a liability with no feature behind
    it. All we keep is who `external_id` is.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="biometric_enrolments"
    )
    student = models.ForeignKey(
        Student, on_delete=models.CASCADE, related_name="biometric_enrolments"
    )
    device = models.CharField(max_length=64)
    external_id = models.CharField(max_length=64, help_text="The reader's own user number.")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["device", "external_id"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "device", "external_id"],
                name="one_member_per_reader_id",
            )
        ]

    def __str__(self):
        return f"{self.device}#{self.external_id} = {self.student.full_name}"
