import uuid

from django.db import models

from organizations.models import Organization

from .constants import Metric, Pose, Unit


class MeasurementEntry(models.Model):
    """One reading of one body metric on one day."""

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="measurements"
    )
    user_id = models.CharField(max_length=64)

    metric = models.CharField(max_length=20, choices=Metric.CHOICES)
    value = models.DecimalField(max_digits=6, decimal_places=2)
    unit = models.CharField(max_length=10, choices=Unit.CHOICES)
    measured_on = models.DateField()
    notes = models.CharField(max_length=255, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-measured_on"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "user_id", "metric", "measured_on"],
                name="one_reading_per_metric_per_day",
            )
        ]

    def __str__(self):
        return f"{self.metric} {self.value}{self.unit} on {self.measured_on}"


def progress_photo_path(instance, filename):
    """Unguessable path. These files are never served statically — only
    through a view that checks the requester owns them."""
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpg"
    return f"progress_photos/{instance.organization_id}/{uuid.uuid4().hex}.{extension}"


class ProgressPhoto(models.Model):
    """A progress photo. Private to the member who uploaded it — trainers do
    not get access implicitly, since these are pictures of someone's body."""

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="progress_photos"
    )
    user_id = models.CharField(max_length=64)

    image = models.ImageField(upload_to=progress_photo_path)
    pose = models.CharField(max_length=10, choices=Pose.CHOICES, default=Pose.FRONT)
    taken_on = models.DateField()
    notes = models.CharField(max_length=255, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-taken_on", "-id"]

    def __str__(self):
        return f"{self.pose} photo on {self.taken_on}"
