import uuid

from django.db import transaction
from django.db.models import Count, Q
from django.http import FileResponse, Http404
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import generics, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from batches.models import Batch
from organizations.models import Branch
from students.models import Student
from tenants.context import get_current_academy
from tenants.mixins import OrganizationScopedMixin
from tenants.permissions import (
    IsOrganizationManager,
    IsOrganizationMember,
    IsOrganizationStaff,
    IsPerson,
)

from .admission import admission_for
from .models import (
    AttendanceRecord,
    AttendanceStatus,
    BiometricEnrolment,
    CheckIn,
    CheckInMethod,
)
from .serializers import (
    AttendanceRecordSerializer,
    BiometricEnrolmentSerializer,
    CheckInSerializer,
    DevicePunchSerializer,
    MarkAttendanceSerializer,
    MemberPassSerializer,
    ScanSerializer,
)


class AttendanceListView(OrganizationScopedMixin, generics.ListAPIView):
    serializer_class = AttendanceRecordSerializer

    def get_queryset(self):
        queryset = self.scoped(AttendanceRecord).select_related("student")
        params = self.request.query_params
        if batch := params.get("batch"):
            queryset = queryset.filter(batch_id=batch)
        if student := params.get("student"):
            queryset = queryset.filter(student_id=student)
        if date := params.get("date"):
            queryset = queryset.filter(date=date)
        return queryset


@api_view(["POST"])
@permission_classes([IsOrganizationStaff])
@transaction.atomic
def mark_register(request):
    """Marks a batch's register for a date. Re-marking updates the existing
    rows instead of failing on the one-mark-per-day constraint."""
    academy = get_current_academy(request)
    serializer = MarkAttendanceSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    try:
        batch = Batch.objects.get(pk=data["batch"], academy=academy)
    except Batch.DoesNotExist:
        return Response({"detail": "Batch not found."}, status=status.HTTP_404_NOT_FOUND)

    allowed_students = set(
        Student.objects.filter(academy=academy).values_list("id", flat=True)
    )

    written = []
    for mark in data["marks"]:
        if mark["student"] not in allowed_students:
            return Response(
                {"detail": f"Student {mark['student']} is not in this academy."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        record, _ = AttendanceRecord.objects.update_or_create(
            academy=academy,
            batch=batch,
            student_id=mark["student"],
            date=data["date"],
            defaults={
                "status": mark["status"],
                "note": mark.get("note", ""),
                "marked_by": request.user.id,
            },
        )
        written.append(record)

    return Response(
        AttendanceRecordSerializer(written, many=True).data, status=status.HTTP_200_OK
    )


@api_view(["GET"])
@permission_classes([IsOrganizationMember])
def attendance_summary(request):
    """Attendance rate per student for a batch, over all marked days."""
    academy = get_current_academy(request)
    records = AttendanceRecord.objects.filter(academy=academy).select_related("student")
    if batch := request.query_params.get("batch"):
        records = records.filter(batch_id=batch)

    per_student = {}
    for record in records:
        entry = per_student.setdefault(
            record.student_id,
            {"student": record.student_id, "student_name": record.student.full_name,
             "marked": 0, "attended": 0},
        )
        entry["marked"] += 1
        if record.status in AttendanceStatus.ATTENDED:
            entry["attended"] += 1

    rows = sorted(per_student.values(), key=lambda r: r["student_name"])
    for row in rows:
        row["rate"] = round(row["attended"] / row["marked"], 3) if row["marked"] else None

    return Response({"students": rows})


def _open_visit(student, on):
    """An open visit from the same day. Scanning twice on the way in is one
    visit; a reader flushing yesterday's buffer is not."""
    return CheckIn.objects.filter(
        student=student, admitted=True, checked_out_at__isnull=True,
        checked_in_at__date=on,
    ).order_by("-checked_in_at").first()


def record_check_in(academy, student, *, method, device="", branch=None, at=None):
    """The only path a check-in is created by. Returns (check_in, created);
    refused attempts are recorded too."""
    at = at or timezone.now()
    existing = _open_visit(student, timezone.localdate(at))
    if existing is not None:
        return existing, False

    admission = admission_for(student)
    check_in = CheckIn.objects.create(
        academy=academy,
        student=student,
        branch=branch or student.branch,
        subscription=admission.subscription if admission.allowed else None,
        checked_in_at=at,
        method=method,
        admitted=admission.allowed,
        refused_reason="" if admission.allowed else admission.reason,
        device=device,
    )
    check_in.mark_register()
    return check_in, True


class CheckInScopedMixin(OrganizationScopedMixin):
    """The visit log names members, so: people only. A turnstile gets `scan`."""

    serializer_class = CheckInSerializer
    permission_classes = [IsOrganizationStaff, IsPerson]


class CheckInListCreateView(CheckInScopedMixin, generics.ListCreateAPIView):
    def get_queryset(self):
        queryset = self.scoped(CheckIn).select_related(
            "student", "branch", "subscription__tier"
        )
        params = self.request.query_params

        if student := params.get("student"):
            queryset = queryset.filter(student_id=student)
        if branch := params.get("branch"):
            queryset = queryset.filter(branch_id=branch)
        if params.get("inside") == "true":
            queryset = queryset.filter(admitted=True, checked_out_at__isnull=True)
        if params.get("refused") == "true":
            queryset = queryset.filter(admitted=False)
        if on := parse_date(params.get("date", "")):
            queryset = queryset.filter(checked_in_at__date=on)
        return queryset

    def create(self, request, *args, **kwargs):
        """A refusal is a 201 with `admitted: false` — it was recorded. The
        screen reads `admitted`; it doesn't need an error."""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        check_in, created = record_check_in(
            self.academy,
            serializer.validated_data["student"],
            method=serializer.validated_data.get("method", CheckInMethod.MANUAL),
            branch=serializer.validated_data.get("branch"),
        )
        return Response(
            CheckInSerializer(check_in).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class CheckInDetailView(CheckInScopedMixin, generics.RetrieveDestroyAPIView):
    def get_queryset(self):
        return self.scoped(CheckIn).select_related(
            "student", "branch", "subscription__tier"
        )

    def get_permissions(self):
        # Deleting a visit rewrites the door's history; a mis-scan is the only
        # honest reason to.
        if self.request.method == "DELETE":
            return [IsOrganizationManager(), IsPerson()]
        return super().get_permissions()


@api_view(["POST"])
@permission_classes([IsOrganizationStaff, IsPerson])
def check_out(request, pk):
    academy = get_current_academy(request)
    check_in = CheckIn.objects.filter(academy=academy, pk=pk).first()
    if check_in is None:
        return Response({"detail": "No such visit."}, status=status.HTTP_404_NOT_FOUND)
    if check_in.checked_out_at is not None:
        return Response(CheckInSerializer(check_in).data)
    return Response(CheckInSerializer(check_in.check_out()).data)


@api_view(["POST"])
@permission_classes([IsOrganizationMember])
def scan(request):
    """The door. Open to API keys — the caller is a turnstile, not a person.
    Takes a pass token only; a scanner that accepted a member id would be
    worth stealing."""
    academy = get_current_academy(request)
    serializer = ScanSerializer(data=request.data, context={"academy": academy})
    serializer.is_valid(raise_exception=True)

    student = serializer.context["student"]
    branch = None
    if branch_id := serializer.validated_data.get("branch"):
        branch = Branch.objects.filter(academy=academy, pk=branch_id).first()

    check_in, created = record_check_in(
        academy, student,
        method=CheckInMethod.QR,
        device=serializer.validated_data.get("device", ""),
        branch=branch,
    )

    data = CheckInSerializer(check_in).data
    data["already_inside"] = not created
    return Response(
        data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK
    )


@api_view(["GET"])
@permission_classes([IsOrganizationStaff, IsPerson])
def today(request):
    """Who is in, how busy it's been, and who was turned away."""
    academy = get_current_academy(request)
    on = parse_date(request.query_params.get("date", "")) or timezone.localdate()

    visits = CheckIn.objects.filter(
        academy=academy, checked_in_at__date=on
    ).select_related("student", "subscription__tier")

    # An alias can't reuse a field name; `admitted=Count(...)` is refused.
    totals = visits.aggregate(
        admitted_count=Count("id", filter=Q(admitted=True)),
        refused_count=Count("id", filter=Q(admitted=False)),
        inside_count=Count("id", filter=Q(admitted=True, checked_out_at__isnull=True)),
    )

    return Response({
        "date": on,
        "counts": {key.removesuffix("_count"): value for key, value in totals.items()},
        "inside": CheckInSerializer(
            [v for v in visits if v.is_inside], many=True
        ).data,
        "refused": CheckInSerializer(
            [v for v in visits if not v.admitted], many=True
        ).data,
    })


@api_view(["GET"])
@permission_classes([IsOrganizationStaff, IsPerson])
def admission(request, pk):
    """Can they come in? Answered without recording a visit."""
    academy = get_current_academy(request)
    student = Student.objects.filter(academy=academy, pk=pk).first()
    if student is None:
        return Response({"detail": "No such member."}, status=status.HTTP_404_NOT_FOUND)

    verdict = admission_for(student)
    return Response({
        "student": student.id,
        "student_name": student.full_name,
        "allowed": verdict.allowed,
        "reason": verdict.reason or "",
        "message": verdict.message,
        "expires_on": verdict.subscription.expires_on if verdict.subscription else None,
        "days_remaining": (
            verdict.subscription.days_remaining if verdict.subscription else None
        ),
    })


class MemberPassView(OrganizationScopedMixin, generics.GenericAPIView):
    """One member's pass token. POST reissues it, killing the old QR."""

    serializer_class = MemberPassSerializer
    permission_classes = [IsOrganizationStaff, IsPerson]

    def student(self):
        student = self.scoped(Student).filter(pk=self.kwargs["pk"]).first()
        if student is None:
            raise Http404
        return student

    def get(self, request, pk):
        return Response(self.get_serializer(self.student()).data)

    def post(self, request, pk):
        student = self.student()
        student.qr_token = uuid.uuid4()
        student.save(update_fields=["qr_token"])
        return Response(self.get_serializer(student).data)


class MemberPassImageView(MemberPassView):
    """The pass as a PNG. Server-side so the same image prints, emails and
    shows on a phone."""

    def get(self, request, pk):
        import io

        import qrcode

        student = self.student()
        image = qrcode.make(str(student.qr_token), box_size=8, border=2)

        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        buffer.seek(0)

        response = FileResponse(buffer, content_type="image/png")
        # The token is the secret; don't leave copies on a shared desk machine.
        response["Cache-Control"] = "no-store"
        return response

    def post(self, request, pk):
        raise Http404


@api_view(["POST"])
@permission_classes([IsOrganizationMember])
def device_punch(request):
    """A biometric reader reporting a match.

    The device does the matching and keeps the template; we only map its user
    number to a member and run the same admission rule the door already uses.
    """
    academy = get_current_academy(request)
    serializer = DevicePunchSerializer(
        data=request.data, context={"academy": academy}
    )
    serializer.is_valid(raise_exception=True)

    check_in, created = record_check_in(
        academy,
        serializer.context["student"],
        method=CheckInMethod.BIOMETRIC,
        device=serializer.validated_data["device"],
        at=serializer.validated_data.get("at"),
    )

    data = CheckInSerializer(check_in).data
    data["already_inside"] = not created
    return Response(
        data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK
    )


class EnrolmentScopedMixin(OrganizationScopedMixin):
    """Which reader id is whom. A door credential, so managers only, and never
    an API key — a reader pushes punches, it does not hand out mappings."""

    serializer_class = BiometricEnrolmentSerializer
    permission_classes = [IsOrganizationManager, IsPerson]

    def get_queryset(self):
        return self.scoped(BiometricEnrolment).select_related("student")


class EnrolmentListCreateView(EnrolmentScopedMixin, generics.ListCreateAPIView):
    def get_queryset(self):
        queryset = super().get_queryset()
        if student := self.request.query_params.get("student"):
            queryset = queryset.filter(student_id=student)
        return queryset


class EnrolmentDetailView(EnrolmentScopedMixin, generics.RetrieveDestroyAPIView):
    pass
