from rest_framework import serializers

from .models import LaneBooking, Pool, SkillAssessment, SwimLevel, SwimSkill


class PoolSerializer(serializers.ModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True, default=None)

    class Meta:
        model = Pool
        fields = ["id", "name", "lane_count", "is_active", "branch", "branch_name"]
        read_only_fields = ["id", "branch_name"]


class LaneBookingSerializer(serializers.ModelSerializer):
    pool_name = serializers.CharField(source="pool.name", read_only=True)
    batch_name = serializers.CharField(source="batch.name", read_only=True, default=None)

    class Meta:
        model = LaneBooking
        fields = [
            "id", "pool", "pool_name", "lane_number", "batch", "batch_name",
            "day_of_week", "start_time", "end_time", "note",
        ]
        read_only_fields = ["id", "pool_name", "batch_name"]

    def validate(self, attrs):
        organization = self.context["organization"]
        merged = {**{f: getattr(self.instance, f, None) for f in
                     ("pool", "lane_number", "day_of_week", "start_time", "end_time", "batch")},
                  **attrs}

        pool = merged["pool"]
        if pool.organization_id != organization.id:
            raise serializers.ValidationError({"pool": "That pool belongs to another organization."})

        batch = merged.get("batch")
        if batch and batch.organization_id != organization.id:
            raise serializers.ValidationError({"batch": "That batch belongs to another organization."})

        if not 0 <= merged["day_of_week"] <= 6:
            raise serializers.ValidationError({"day_of_week": "Must be 0 (Mon) to 6 (Sun)."})
        if merged["start_time"] >= merged["end_time"]:
            raise serializers.ValidationError({"end_time": "End time must be after the start time."})
        if merged["lane_number"] < 1 or merged["lane_number"] > pool.lane_count:
            raise serializers.ValidationError(
                {"lane_number": f"{pool.name} has lanes 1–{pool.lane_count}."}
            )

        candidate = LaneBooking(
            pk=self.instance.pk if self.instance else None,
            pool=pool, lane_number=merged["lane_number"],
            day_of_week=merged["day_of_week"],
            start_time=merged["start_time"], end_time=merged["end_time"],
        )
        existing = LaneBooking.objects.filter(
            organization=organization, pool=pool,
            lane_number=merged["lane_number"], day_of_week=merged["day_of_week"],
        ).select_related("batch")
        clashes = candidate.clashes_with(list(existing))
        if clashes:
            other = clashes[0]
            raise serializers.ValidationError(
                {"lane_number": (
                    f"Lane {other.lane_number} is already booked "
                    f"{other.start_time:%H:%M}–{other.end_time:%H:%M}"
                    f"{f' for {other.batch.name}' if other.batch else ''}."
                )}
            )
        return attrs


class SwimSkillSerializer(serializers.ModelSerializer):
    class Meta:
        model = SwimSkill
        fields = ["id", "name", "position"]
        read_only_fields = ["id"]


class SwimLevelSerializer(serializers.ModelSerializer):
    skills = SwimSkillSerializer(many=True, read_only=True)

    class Meta:
        model = SwimLevel
        fields = ["id", "name", "position", "description", "skills"]
        read_only_fields = ["id", "skills"]


class SkillAssessmentSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    skill_name = serializers.CharField(source="skill.name", read_only=True)

    class Meta:
        model = SkillAssessment
        fields = [
            "id", "student", "student_name", "skill", "skill_name",
            "achieved_on", "assessed_by", "note",
        ]
        read_only_fields = ["id", "student_name", "skill_name", "assessed_by"]

    def validate_student(self, value):
        if value.organization_id != self.context["organization"].id:
            raise serializers.ValidationError("That student belongs to another organization.")
        return value

    def validate_skill(self, value):
        if value.level.organization_id != self.context["organization"].id:
            raise serializers.ValidationError("That skill belongs to another organization.")
        return value
