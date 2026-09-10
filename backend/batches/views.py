from datetime import time, timedelta

from django.db import transaction
from django.db.models import Count
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import generics, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from students.models import Student
from tenants.context import get_current_academy
from tenants.mixins import OrganizationScopedMixin
from tenants.permissions import IsOrganizationMember, IsOrganizationStaff

from .allowance import classes_allowed_per_week
from .models import (
    Batch, BookingStatus, ClassBooking, Enrolment, booked_that_week, is_regular,
)
from .serializers import BatchSerializer, ClassBookingSerializer, EnrolmentSerializer


class BatchListCreateView(OrganizationScopedMixin, generics.ListCreateAPIView):
    serializer_class = BatchSerializer

    def get_queryset(self):
        queryset = self.scoped(Batch).select_related("branch")
        if self.request.query_params.get("active") == "true":
            queryset = queryset.filter(is_active=True)
        return queryset


class BatchDetailView(OrganizationScopedMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = BatchSerializer

    def get_queryset(self):
        return self.scoped(Batch).select_related("branch")


class EnrolmentListCreateView(OrganizationScopedMixin, generics.ListCreateAPIView):
    serializer_class = EnrolmentSerializer

    def get_queryset(self):
        queryset = Enrolment.objects.filter(
            batch__academy=self.academy
        ).select_related("student", "batch")
        params = self.request.query_params
        if batch := params.get("batch"):
            queryset = queryset.filter(batch_id=batch)
        if student := params.get("student"):
            queryset = queryset.filter(student_id=student)
        return queryset

    def perform_create(self, serializer):
        # Enrolment has no academy column of its own — it inherits scope
        # from the batch, which the serializer has already validated.
        serializer.save()


class EnrolmentDetailView(OrganizationScopedMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = EnrolmentSerializer

    def get_queryset(self):
        return Enrolment.objects.filter(
            batch__academy=self.academy
        ).select_related("student", "batch")


class BookingScopedMixin(OrganizationScopedMixin):
    serializer_class = ClassBookingSerializer


class BookingListCreateView(BookingScopedMixin, generics.ListCreateAPIView):
    def get_queryset(self):
        queryset = self.scoped(ClassBooking).select_related("batch", "student")
        params = self.request.query_params

        if student := params.get("student"):
            queryset = queryset.filter(student_id=student)
        if batch := params.get("batch"):
            queryset = queryset.filter(batch_id=batch)
        if start := parse_date(params.get("from", "")):
            queryset = queryset.filter(session_date__gte=start)
        if end := parse_date(params.get("to", "")):
            queryset = queryset.filter(session_date__lte=end)
        if params.get("open") == "true":
            queryset = queryset.filter(status__in=BookingStatus.OPEN)
        return queryset

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        """Books a place, or joins the queue when the session is full.

        A full session is not an error — a waitlisted place is a real answer,
        and the response says which one they got.
        """
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        batch = serializer.validated_data["batch"]
        student = serializer.validated_data["student"]
        day = serializer.validated_data["session_date"]

        full = (
            batch.capacity is not None
            and ClassBooking.places_taken(batch, day) >= batch.capacity
        )

        # Waiting doesn't spend a credit; only a place does.
        if not full:
            allowed = classes_allowed_per_week(student)
            if allowed is not None and booked_that_week(student, day) >= allowed:
                raise ValidationError({"student": (
                    f"{student.full_name} has used all {allowed} classes for that week."
                )})

        booking = ClassBooking.objects.create(
            academy=self.academy, batch=batch, student=student, session_date=day,
            status=BookingStatus.WAITLISTED if full else BookingStatus.BOOKED,
        )
        return Response(
            ClassBookingSerializer(booking).data, status=status.HTTP_201_CREATED
        )


class BookingDetailView(BookingScopedMixin, generics.RetrieveAPIView):
    def get_queryset(self):
        return self.scoped(ClassBooking).select_related("batch", "student")


@api_view(["POST"])
@permission_classes([IsOrganizationStaff])
@transaction.atomic
def cancel_booking(request, pk):
    """Gives the place up. Whoever is first in the queue takes it."""
    academy = get_current_academy(request)
    booking = ClassBooking.objects.filter(academy=academy, pk=pk).first()
    if booking is None or not booking.is_open:
        return Response(
            {"detail": "No open booking here."}, status=status.HTTP_404_NOT_FOUND
        )

    promoted = booking.cancel()
    return Response({
        **ClassBookingSerializer(booking).data,
        "promoted": ClassBookingSerializer(promoted).data if promoted else None,
    })


@api_view(["POST"])
@permission_classes([IsOrganizationStaff])
@transaction.atomic
def skip_session(request):
    """A regular saying they aren't coming, or taking the day back.

    Their place is held by the roster rather than by a row, so this is the
    only way to free it — and freeing it lets the waitlist move.
    """
    academy = get_current_academy(request)
    batch = Batch.objects.filter(academy=academy, pk=request.data.get("batch")).first()
    student = Student.objects.filter(
        academy=academy, pk=request.data.get("student")
    ).first()
    day = parse_date(str(request.data.get("session_date", "")))

    if batch is None or student is None or day is None:
        raise ValidationError({"detail": "Need a batch, a member and a date."})
    if not is_regular(batch, student, day):
        raise ValidationError(
            {"student": f"{student.full_name} isn't in {batch.name}, so there is "
                        "nothing to skip — cancel their booking instead."}
        )

    if request.data.get("coming") is True:
        row = ClassBooking.objects.filter(
            batch=batch, student=student, session_date=day,
            status=BookingStatus.SKIPPED,
        ).first()
        if row is None:
            raise ValidationError({"student": "They were already expected."})
        if not row.unskip():
            raise ValidationError(
                {"student": f"{batch.name} filled up while they were away."}
            )
        return Response({"status": "expected", "promoted": None})

    row, promoted = ClassBooking.mark_skip(batch, student, day)
    return Response({
        "status": row.status,
        "promoted": ClassBookingSerializer(promoted).data if promoted else None,
    })


@api_view(["GET"])
@permission_classes([IsOrganizationMember])
def sessions(request):
    """What can be booked, day by day, with what is left.

    Built from each batch's weekday pattern rather than stored, so a batch
    that changes its days doesn't leave phantom sessions behind.
    """
    academy = get_current_academy(request)
    start = parse_date(request.query_params.get("from", "")) or timezone.localdate()
    end = parse_date(request.query_params.get("to", "")) or start + timedelta(days=13)
    end = min(end, start + timedelta(days=60))

    batches = Batch.objects.filter(academy=academy, is_active=True).select_related("coach")
    if branch := request.query_params.get("branch"):
        batches = batches.filter(branch_id=branch)

    # One query for every row that departs from the default, rather than one
    # per session — a fortnight of six batches is eighty-odd sessions.
    counts = {}
    for row in ClassBooking.objects.filter(
        academy=academy, session_date__range=(start, end),
        status__in=[*BookingStatus.OPEN, BookingStatus.SKIPPED],
    ).values("batch_id", "session_date", "status").annotate(total=Count("id")):
        counts[(row["batch_id"], row["session_date"], row["status"])] = row["total"]

    # Regulars come off the roster, so their dates are compared per session.
    enrolments = list(
        Enrolment.objects.filter(batch__in=batches, is_active=True)
        .values("batch_id", "enrolled_on", "left_on")
    )

    def regulars_for(batch_id, day):
        return sum(
            1 for e in enrolments
            if e["batch_id"] == batch_id
            and e["enrolled_on"] <= day
            and (e["left_on"] is None or e["left_on"] >= day)
        )

    rows = []
    for batch in batches:
        for offset in range((end - start).days + 1):
            day = start + timedelta(days=offset)
            # No days set is not "every day" — nobody has said when it runs,
            # so it offers nothing. Same reading the register takes.
            if day.weekday() not in batch.days_of_week:
                continue
            regulars = regulars_for(batch.id, day)
            skipped = counts.get((batch.id, day, BookingStatus.SKIPPED), 0)
            drop_ins = counts.get((batch.id, day, BookingStatus.BOOKED), 0)
            taken = regulars - skipped + drop_ins
            rows.append({
                "batch": batch.id,
                "batch_name": batch.name,
                "coach": (batch.coach.email if batch.coach_id else batch.coach_name),
                "branch": batch.branch_id,
                "session_date": day,
                "start_time": batch.start_time,
                "end_time": batch.end_time,
                "capacity": batch.capacity,
                "regulars": regulars,
                "skipped": skipped,
                "drop_ins": drop_ins,
                "taken": taken,
                "places_left": None if batch.capacity is None else max(batch.capacity - taken, 0),
                "waiting": counts.get((batch.id, day, BookingStatus.WAITLISTED), 0),
            })

    rows.sort(key=lambda r: (r["session_date"], r["start_time"] or time.min, r["batch_name"]))
    return Response({"from": start, "to": end, "sessions": rows})
