from django.db import transaction
from rest_framework import generics, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from batches.models import Batch
from students.models import Student
from tenants.context import get_current_organization
from tenants.mixins import OrganizationScopedMixin
from tenants.permissions import IsOrganizationMember, IsOrganizationStaff

from .models import AttendanceRecord, AttendanceStatus
from .serializers import AttendanceRecordSerializer, MarkAttendanceSerializer


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
    organization = get_current_organization(request)
    serializer = MarkAttendanceSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    try:
        batch = Batch.objects.get(pk=data["batch"], organization=organization)
    except Batch.DoesNotExist:
        return Response({"detail": "Batch not found."}, status=status.HTTP_404_NOT_FOUND)

    allowed_students = set(
        Student.objects.filter(organization=organization).values_list("id", flat=True)
    )

    written = []
    for mark in data["marks"]:
        if mark["student"] not in allowed_students:
            return Response(
                {"detail": f"Student {mark['student']} is not in this organization."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        record, _ = AttendanceRecord.objects.update_or_create(
            organization=organization,
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
    organization = get_current_organization(request)
    records = AttendanceRecord.objects.filter(organization=organization).select_related("student")
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
