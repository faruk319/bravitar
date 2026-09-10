"""The member's own view of their record.

Everything here answers for one Student, resolved from the signed-in person
rather than from a URL they could change. `request.students` is the whole set
their login covers — a parent's account reaches each of their children — and
`_theirs` is the only way a view picks one out of it.

Staff endpoints live in views.py. These are kept apart because the question
they answer is different: not "what may this academy see", but "what may this
person see about themselves".
"""

from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response

from tenants.permissions import IsSignedInMember

from .models import Student


def _theirs(request, pk):
    """The student this person is allowed to act for, or 404.

    404 rather than 403: whether a member id exists at all is not something
    to confirm to somebody it doesn't belong to.
    """
    student = request.students.filter(pk=pk).first()
    if student is None:
        raise NotFound("No such member.")
    return student


class MyDetailsSerializer(serializers.ModelSerializer):
    """What a member may change about themselves.

    Name, branch, status and joined date are absent on purpose — those are the
    academy's record of them, not their preferences, and letting somebody edit
    their own join date would rewrite history the money depends on.
    """

    class Meta:
        model = Student
        fields = ["phone", "email", "guardian_name", "guardian_phone"]


@api_view(["GET"])
@permission_classes([IsSignedInMember])
def whoami(request):
    """Who this login covers. Usually one person; a parent's covers several."""
    return Response({
        "members": [
            {
                "id": s.id,
                "full_name": s.full_name,
                "academy": s.academy.name,
                "branch": s.branch.name if s.branch_id else None,
                "status": s.status,
                "photo": s.photo.url if s.photo else None,
            }
            for s in request.students
        ]
    })


@api_view(["GET", "PATCH"])
@permission_classes([IsSignedInMember])
def my_details(request, pk):
    student = _theirs(request, pk)
    if request.method == "PATCH":
        serializer = MyDetailsSerializer(student, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
    return Response({
        "id": student.id,
        "full_name": student.full_name,
        "phone": student.phone,
        "email": student.email,
        "guardian_name": student.guardian_name,
        "guardian_phone": student.guardian_phone,
        "branch": student.branch.name if student.branch_id else None,
        "joined_on": student.joined_on,
        "status": student.status,
    })


@api_view(["GET"])
@permission_classes([IsSignedInMember])
def my_overview(request, pk):
    """Plan, money and whether the door would let them in — the three things
    somebody actually opens the app to check."""
    from attendance.admission import admission_for
    from billing.models import Invoice
    from subscriptions.models import MemberSubscription

    student = _theirs(request, pk)

    current = next(
        (s for s in student.subscriptions.select_related("tier").all() if s.is_current),
        None,
    )
    pending = next(
        (s for s in student.subscriptions.select_related("tier").all()
         if s.status == "pending"),
        None,
    )
    plan = current or pending

    owed = sum(
        invoice.balance
        for invoice in Invoice.objects.filter(student=student, is_cancelled=False)
    )
    verdict = admission_for(student)

    return Response({
        "plan": None if plan is None else {
            "name": plan.tier.name,
            "status": plan.status,
            "expires_on": plan.expires_on,
            "days_remaining": plan.days_remaining,
        },
        "owed": owed,
        "may_train": verdict.allowed,
        "why_not": None if verdict.allowed else verdict.message,
    })


@api_view(["GET"])
@permission_classes([IsSignedInMember])
def my_attendance(request, pk):
    from attendance.models import AttendanceRecord

    student = _theirs(request, pk)
    since = timezone.localdate() - timedelta(days=90)
    records = (
        AttendanceRecord.objects.filter(student=student, date__gte=since)
        .select_related("batch").order_by("-date")[:100]
    )
    return Response({"records": [
        {
            "date": r.date,
            "batch": r.batch.name if r.batch_id else None,
            "status": r.status,
        }
        for r in records
    ]})


@api_view(["GET"])
@permission_classes([IsSignedInMember])
def my_invoices(request, pk):
    from billing.models import Invoice

    student = _theirs(request, pk)
    invoices = Invoice.objects.filter(student=student).order_by("-issued_on")[:50]
    return Response({"invoices": [
        {
            "id": i.id,
            "description": i.description,
            "amount": i.amount,
            "amount_paid": i.amount_paid,
            "balance": i.balance,
            "due_on": i.due_on,
            "status": i.status,
        }
        for i in invoices
    ]})


@api_view(["GET"])
@permission_classes([IsSignedInMember])
def my_sessions(request, pk):
    """What they can book in the next fortnight, and where they already stand.

    Reuses the same calendar the desk sees rather than computing a second
    one — a member being told there is a place when the desk knows there
    isn't would be worse than no app at all.
    """
    from batches.models import BookingStatus, ClassBooking, Enrolment, regulars_on
    from batches.views import build_sessions

    student = _theirs(request, pk)
    start = timezone.localdate()
    end = start + timedelta(days=13)

    rows = build_sessions(student.academy, start, end)

    mine = {
        (b.batch_id, b.session_date): b
        for b in ClassBooking.objects.filter(
            student=student, session_date__range=(start, end),
            status__in=[*BookingStatus.OPEN, BookingStatus.SKIPPED],
        )
    }
    regular_batches = set(
        Enrolment.objects.filter(
            student=student, is_active=True
        ).values_list("batch_id", flat=True)
    )

    out = []
    for row in rows:
        booking = mine.get((row["batch"], row["session_date"]))
        is_regular = row["batch"] in regular_batches and regulars_on(
            row["batch"], row["session_date"]
        ).filter(student=student).exists()

        if booking and booking.status == BookingStatus.SKIPPED:
            standing = "away"
        elif booking:
            standing = booking.status
        elif is_regular:
            standing = "regular"
        else:
            standing = None

        out.append({
            **row,
            "standing": standing,
            "booking": booking.id if booking and booking.is_open else None,
        })
    return Response({"from": start, "to": end, "sessions": out})


@api_view(["POST"])
@permission_classes([IsSignedInMember])
@transaction.atomic
def my_booking(request, pk):
    """Take a place, join the queue, or give a place up.

    Deliberately thin: every rule about capacity, credits and the waitlist
    lives where the desk's booking lives, so the two cannot drift apart and
    start giving different answers about the same session.
    """
    from batches.models import Batch, BookingStatus, ClassBooking, is_regular
    from batches.serializers import ClassBookingSerializer
    from batches.views import place_booking

    student = _theirs(request, pk)
    action = request.data.get("action", "book")
    batch = Batch.objects.filter(
        academy=student.academy, pk=request.data.get("batch")
    ).first()
    day = request.data.get("session_date")

    if batch is None or not day:
        raise ValidationError({"detail": "Need a class and a date."})

    if action == "book":
        # The student comes from the signed-in person, never from the body,
        # so nobody can book a place in somebody else's name.
        booking = place_booking(student.academy, {
            "batch": batch.id, "student": student.id, "session_date": day,
        })
        return Response(
            ClassBookingSerializer(booking).data, status=status.HTTP_201_CREATED
        )

    if action == "cancel":
        booking = ClassBooking.objects.filter(
            batch=batch, student=student, session_date=day,
            status__in=BookingStatus.OPEN,
        ).first()
        if booking is None:
            raise ValidationError({"detail": "You have no place to give up."})
        booking.cancel()
        return Response({"standing": None})

    if action == "away":
        if not is_regular(batch, student, day):
            raise ValidationError(
                {"detail": "You are not in this class, so there is nothing to skip."}
            )
        ClassBooking.mark_skip(batch, student, day)
        return Response({"standing": "away"})

    if action == "coming":
        row = ClassBooking.objects.filter(
            batch=batch, student=student, session_date=day,
            status=BookingStatus.SKIPPED,
        ).first()
        if row is None or not row.unskip():
            raise ValidationError({"detail": "That place has gone."})
        return Response({"standing": "regular"})

    raise ValidationError({"action": "Not something you can do to a session."})
