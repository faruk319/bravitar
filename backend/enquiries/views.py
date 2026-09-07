from django.db import transaction
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from students.constants import StudentStatus
from students.models import Student
from students.serializers import StudentSerializer
from tenants.context import get_current_organization
from tenants.mixins import OrganizationScopedMixin
from tenants.permissions import IsOrganizationMember, IsOrganizationStaff

from .constants import EnquirySource, EnquiryStatus
from .models import Enquiry
from .serializers import EnquirySerializer


class EnquiryListCreateView(OrganizationScopedMixin, generics.ListCreateAPIView):
    serializer_class = EnquirySerializer

    def get_queryset(self):
        queryset = self.scoped(Enquiry).select_related("branch", "converted_student")
        params = self.request.query_params
        if status_filter := params.get("status"):
            queryset = queryset.filter(status=status_filter)
        if params.get("open") == "true":
            queryset = queryset.filter(status__in=EnquiryStatus.OPEN)
        return queryset


class EnquiryDetailView(OrganizationScopedMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = EnquirySerializer

    def get_queryset(self):
        return self.scoped(Enquiry).select_related("branch", "converted_student")


@api_view(["POST"])
@permission_classes([IsOrganizationStaff])
@transaction.atomic
def convert_enquiry(request, pk):
    """Turns an enquiry into a student. Idempotent: converting twice returns
    the student already created rather than making a duplicate."""
    organization = get_current_organization(request)

    try:
        enquiry = Enquiry.objects.select_for_update().get(pk=pk, organization=organization)
    except Enquiry.DoesNotExist:
        return Response({"detail": "Enquiry not found."}, status=status.HTTP_404_NOT_FOUND)

    if enquiry.converted_student_id:
        return Response(
            {
                "detail": "This enquiry was already converted.",
                "student": StudentSerializer(enquiry.converted_student).data,
            },
            status=status.HTTP_200_OK,
        )

    student = Student.objects.create(
        organization=organization,
        branch=enquiry.branch,
        full_name=enquiry.name,
        phone=enquiry.phone,
        email=enquiry.email,
        status=request.data.get("status", StudentStatus.ACTIVE),
        joined_on=request.data.get("joined_on") or timezone.localdate(),
        notes=enquiry.notes,
    )

    enquiry.converted_student = student
    enquiry.status = EnquiryStatus.CONVERTED
    enquiry.save(update_fields=["converted_student", "status", "updated_at"])

    return Response(StudentSerializer(student).data, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([IsOrganizationMember])
def enquiry_funnel(request):
    """Counts by stage and source, plus the conversion rate — the number an
    owner actually wants from this module."""
    organization = get_current_organization(request)
    enquiries = Enquiry.objects.filter(organization=organization)

    by_status = {value: 0 for value, _ in EnquiryStatus.CHOICES}
    by_source = {value: 0 for value, _ in EnquirySource.CHOICES}
    for enquiry in enquiries:
        by_status[enquiry.status] = by_status.get(enquiry.status, 0) + 1
        by_source[enquiry.source] = by_source.get(enquiry.source, 0) + 1

    total = sum(by_status.values())
    converted = by_status.get(EnquiryStatus.CONVERTED, 0)

    return Response(
        {
            "total": total,
            "converted": converted,
            "open": sum(by_status.get(s, 0) for s in EnquiryStatus.OPEN),
            "conversion_rate": round(converted / total, 3) if total else None,
            "by_status": by_status,
            "by_source": by_source,
        }
    )
