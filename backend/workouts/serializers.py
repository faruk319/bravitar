from django.db import transaction
from rest_framework import serializers

from exercises.models import Exercise
from exercises.serializers import ExerciseSerializer

from .models import Routine, RoutineExercise, SetLog, WorkoutSession


class RoutineExerciseSerializer(serializers.ModelSerializer):
    exercise = ExerciseSerializer(read_only=True)
    exercise_id = serializers.PrimaryKeyRelatedField(
        queryset=Exercise.objects.all(), source="exercise", write_only=True
    )

    class Meta:
        model = RoutineExercise
        fields = [
            "id", "exercise", "exercise_id", "position",
            "target_sets", "target_reps", "target_reps_max", "target_weight",
            "rest_seconds", "superset_group", "notes",
        ]
        read_only_fields = ["id"]


class RoutineSerializer(serializers.ModelSerializer):
    items = RoutineExerciseSerializer(many=True, required=False)

    class Meta:
        model = Routine
        fields = [
            "id", "name", "description", "is_archived", "items",
            "progression", "progression_increment", "created_at",
        ]
        read_only_fields = ["id", "created_at"]

    def validate_items(self, value):
        """Exercises must come from this org's visible library — otherwise a
        routine could reference another academy's custom exercise."""
        organization = self.context["organization"]
        visible = set(
            Exercise.objects.visible_to(organization).values_list("id", flat=True)
        )
        for item in value:
            if item["exercise"].id not in visible:
                raise serializers.ValidationError(
                    f"Exercise {item['exercise'].id} is not available to this organization."
                )
        return value

    @transaction.atomic
    def create(self, validated_data):
        items = validated_data.pop("items", [])
        routine = Routine.objects.create(**validated_data)
        self._replace_items(routine, items)
        return routine

    @transaction.atomic
    def update(self, instance, validated_data):
        items = validated_data.pop("items", None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        if items is not None:
            self._replace_items(instance, items)
        return instance

    @staticmethod
    def _replace_items(routine, items):
        routine.items.all().delete()
        RoutineExercise.objects.bulk_create(
            [
                RoutineExercise(routine=routine, position=position, **item)
                for position, item in enumerate(items)
            ]
        )


class SetLogSerializer(serializers.ModelSerializer):
    exercise = ExerciseSerializer(read_only=True)
    exercise_id = serializers.PrimaryKeyRelatedField(
        queryset=Exercise.objects.all(), source="exercise", write_only=True
    )

    class Meta:
        model = SetLog
        fields = [
            "id", "exercise", "exercise_id", "set_number", "reps", "weight",
            "is_warmup", "rir", "estimated_1rm", "is_personal_record", "logged_at",
        ]
        read_only_fields = ["id", "estimated_1rm", "is_personal_record", "logged_at"]

    def validate_exercise_id(self, value):
        organization = self.context["organization"]
        if not Exercise.objects.visible_to(organization).filter(pk=value.pk).exists():
            raise serializers.ValidationError("That exercise is not available to this organization.")
        return value


class WorkoutSessionSerializer(serializers.ModelSerializer):
    sets = SetLogSerializer(many=True, read_only=True)
    routine_name = serializers.CharField(source="routine.name", read_only=True, default=None)

    class Meta:
        model = WorkoutSession
        fields = [
            "id", "routine", "routine_name", "started_at", "completed_at", "notes", "sets",
        ]
        read_only_fields = ["id", "started_at", "sets"]
