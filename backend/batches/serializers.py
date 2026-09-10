from django.utils import timezone
from rest_framework import serializers

from attendance.admission import admission_for

from students.models import Student

from .models import Batch, BookingStatus, ClassBooking, Enrolment


class BatchSerializer(serializers.ModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True, default=None)
    enrolled_count = serializers.IntegerField(read_only=True)
    coach_label = serializers.SerializerMethodField()

    class Meta:
        model = Batch
        fields = [
            "id", "name", "description", "coach", "coach_name", "coach_label",
            "days_of_week", "start_time", "end_time", "capacity", "is_active",
            "branch", "branch_name", "enrolled_count",
        ]
        read_only_fields = ["id", "branch_name", "enrolled_count", "coach_label"]

    def get_coach_label(self, batch):
        """Whoever is running it — the linked person, or the old free text."""
        if batch.coach_id:
            return batch.coach.email or batch.coach.user_id
        return batch.coach_name

    def validate_days_of_week(self, value):
        if any(not isinstance(day, int) or day < 0 or day > 6 for day in value):
            raise serializers.ValidationError("Days must be integers 0 (Mon) to 6 (Sun).")
        return value

    def validate_coach(self, value):
        if value and value.organization_id != self.context["academy"].organization_id:
            raise serializers.ValidationError("That person is not on this team.")
        return value

    def validate_branch(self, value):
        if value and value.academy_id != self.context["academy"].id:
            raise serializers.ValidationError("That branch belongs to another academy.")
        allowed = self.context.get("allowed_branches")
        if value and allowed is not None and value.id not in allowed:
            raise serializers.ValidationError("You don't work at that branch.")
        return value


class EnrolmentSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    batch_name = serializers.CharField(source="batch.name", read_only=True)

    class Meta:
        model = Enrolment
        fields = [
            "id", "batch", "batch_name", "student", "student_name",
            "enrolled_on", "left_on", "is_active",
        ]
        read_only_fields = ["id", "student_name", "batch_name"]

    def validate(self, attrs):
        academy = self.context["academy"]
        batch = attrs.get("batch") or getattr(self.instance, "batch", None)
        student = attrs.get("student") or getattr(self.instance, "student", None)

        if batch and batch.academy_id != academy.id:
            raise serializers.ValidationError({"batch": "That batch belongs to another academy."})
        if student and student.academy_id != academy.id:
            raise serializers.ValidationError({"student": "That student belongs to another academy."})

        if batch and batch.capacity is not None:
            active = batch.enrolments.filter(is_active=True)
            if self.instance:
                active = active.exclude(pk=self.instance.pk)
            if active.count() >= batch.capacity:
                raise serializers.ValidationError(
                    {"batch": f"{batch.name} is full ({batch.capacity} places)."}
                )
        return attrs


class ClassBookingSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    batch_name = serializers.CharField(source="batch.name", read_only=True)
    start_time = serializers.TimeField(source="batch.start_time", read_only=True)
    is_open = serializers.BooleanField(read_only=True)

    class Meta:
        model = ClassBooking
        fields = [
            "id", "batch", "batch_name", "student", "student_name",
            "session_date", "start_time", "status", "is_open", "booked_at",
        ]
        read_only_fields = [
            "id", "batch_name", "student_name", "start_time", "status",
            "is_open", "booked_at",
        ]

    def validate(self, attrs):
        academy = self.context["academy"]
        batch, student = attrs["batch"], attrs["student"]
        day = attrs["session_date"]

        if batch.academy_id != academy.id or student.academy_id != academy.id:
            raise serializers.ValidationError("That belongs to another academy.")
        if not batch.is_active:
            raise serializers.ValidationError({"batch": f"{batch.name} isn't running."})
        if day < timezone.localdate():
            raise serializers.ValidationError(
                {"session_date": "That day has already been and gone."}
            )
        if not batch.days_of_week:
            raise serializers.ValidationError(
                {"batch": f"Nobody has said which days {batch.name} runs. "
                          "Set those first."}
            )
        if day.weekday() not in batch.days_of_week:
            raise serializers.ValidationError(
                {"session_date": f"{batch.name} doesn't run that day."}
            )
        if ClassBooking.objects.filter(
            batch=batch, student=student, session_date=day,
            status__in=BookingStatus.OPEN,
        ).exists():
            raise serializers.ValidationError(
                {"student": f"{student.full_name} already has a place that day."}
            )

        # No point holding a place for somebody the door won't let in.
        verdict = admission_for(student)
        if not verdict.allowed:
            raise serializers.ValidationError(
                {"student": f"{student.full_name} can't book — {verdict.message.lower()}."}
            )
        return attrs
