from rest_framework import serializers

from .constants import Muscle
from .models import Exercise


class ExerciseSerializer(serializers.ModelSerializer):
    is_custom = serializers.BooleanField(read_only=True)

    class Meta:
        model = Exercise
        fields = [
            "id", "name", "slug", "category", "equipment",
            "primary_muscle", "secondary_muscles", "instructions",
            "is_custom",
        ]
        # slug is derived from the name server-side, per academy.
        read_only_fields = ["id", "slug", "is_custom"]

    def validate_secondary_muscles(self, value):
        unknown = set(value) - set(Muscle.VALUES)
        if unknown:
            raise serializers.ValidationError(f"Unknown muscle(s): {', '.join(sorted(unknown))}")
        return value
