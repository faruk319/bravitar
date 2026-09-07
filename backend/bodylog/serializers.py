from rest_framework import serializers

from .constants import Metric
from .models import MeasurementEntry, ProgressPhoto


class MeasurementEntrySerializer(serializers.ModelSerializer):
    unit = serializers.CharField(required=False)

    class Meta:
        model = MeasurementEntry
        fields = ["id", "metric", "value", "unit", "measured_on", "notes"]
        read_only_fields = ["id"]

    def validate(self, attrs):
        metric = attrs.get("metric", getattr(self.instance, "metric", None))
        unit = attrs.get("unit") or Metric.default_unit(metric)

        allowed = Metric.allowed_units(metric)
        if unit not in allowed:
            raise serializers.ValidationError(
                {"unit": f"{metric} must be recorded in one of: {', '.join(allowed)}."}
            )

        attrs["unit"] = unit
        return attrs


class ProgressPhotoSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = ProgressPhoto
        fields = ["id", "pose", "taken_on", "notes", "image", "image_url"]
        read_only_fields = ["id", "image_url"]
        extra_kwargs = {"image": {"write_only": True}}

    def get_image_url(self, obj):
        # Points at the ownership-checked view, never at MEDIA_URL.
        return f"/api/gym/body/photos/{obj.id}/image/"
