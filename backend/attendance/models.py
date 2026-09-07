from django.db import models

from batches.models import Batch
from organizations.models import Organization
from students.models import Student


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
    """One student, one batch, one day. The unique constraint means marking a
    register twice corrects it rather than double-counting."""

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
