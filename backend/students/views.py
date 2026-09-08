from django.db.models import Count
from django.db.models.deletion import ProtectedError
from django.http import FileResponse, Http404
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from tenants.context import get_current_organization
from tenants.mixins import OrganizationScopedMixin
from tenants.permissions import IsOrganizationManager, IsOrganizationStaff, IsPerson

from .constants import DocumentKind, Upload
from .models import MemberDocument, Student
from .serializers import (
    MemberDocumentSerializer,
    MemberPhotoSerializer,
    StudentSerializer,
)


class StudentListCreateView(OrganizationScopedMixin, generics.ListCreateAPIView):
    serializer_class = StudentSerializer

    def get_queryset(self):
        # annotate() drops the model's default ordering, and paging an
        # unordered queryset repeats some members and hides others.
        queryset = (
            self.scoped(Student)
            .select_related("branch")
            .annotate(document_total=Count("documents"))
            .order_by(*Student._meta.ordering)
        )
        params = self.request.query_params
        if search := params.get("search"):
            queryset = queryset.filter(full_name__icontains=search)
        if status_filter := params.get("status"):
            queryset = queryset.filter(status=status_filter)
        return queryset


class StudentDetailView(OrganizationScopedMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = StudentSerializer

    def get_queryset(self):
        return (
            self.scoped(Student)
            .select_related("branch")
            .annotate(document_total=Count("documents"))
            .order_by(*Student._meta.ordering)
        )

    def perform_destroy(self, instance):
        """Invoices PROTECT the member they were raised against, so deleting
        somebody who has ever been billed would come back as a 500. It should
        not be possible anyway: an invoice naming nobody is not a record of
        anything, and a member who stopped coming is marked Left, not erased.
        """
        try:
            instance.delete()
        except ProtectedError as error:
            raise ValidationError({"detail": (
                f"{instance.full_name} has invoices on file, so the record has to "
                "stay — otherwise the money history would name nobody. Set their "
                "status to Left instead."
            )}) from error


class MemberPhotoView(OrganizationScopedMixin, generics.GenericAPIView):
    """A member's photo: upload, replace, remove, and read the bytes.

    Anyone running the academy may see it — that is the point of having it,
    so the desk can match the face to the name. It is still never served
    statically, so the only way to the file is through this check.
    """

    serializer_class = MemberPhotoSerializer
    parser_classes = [MultiPartParser, FormParser]
    permission_classes = [IsOrganizationStaff, IsPerson]

    def student(self):
        student = self.scoped(Student).filter(pk=self.kwargs["pk"]).first()
        if student is None:
            raise Http404
        return student

    def get(self, request, pk):
        student = self.student()
        if not student.photo:
            raise Http404
        return FileResponse(student.photo.open("rb"))

    def put(self, request, pk):
        student = self.student()
        serializer = self.get_serializer(student, data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"has_photo": True})

    def delete(self, request, pk):
        student = self.student()
        if student.photo:
            student.photo.delete(save=True)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MemberDocumentMixin(OrganizationScopedMixin):
    """Proof-of-identity scans are manager-and-owner only, and closed to API
    keys. A coach running a class has no reason to see anybody's Aadhaar, and
    an integration token has less reason still."""

    serializer_class = MemberDocumentSerializer
    permission_classes = [IsOrganizationManager, IsPerson]

    def get_queryset(self):
        return self.scoped(MemberDocument).select_related("student")


class MemberDocumentListCreateView(MemberDocumentMixin, generics.ListCreateAPIView):
    parser_classes = [MultiPartParser, FormParser]

    def get_queryset(self):
        queryset = super().get_queryset()
        if student := self.request.query_params.get("student"):
            queryset = queryset.filter(student_id=student)
        return queryset

    def perform_create(self, serializer):
        serializer.save(
            organization=self.organization,
            uploaded_by=self.request.user.id or "",
        )


class MemberDocumentDetailView(MemberDocumentMixin, generics.RetrieveDestroyAPIView):
    pass


class MemberDocumentFileView(MemberDocumentMixin, generics.GenericAPIView):
    """Streams the scan itself. Separate from the record so that listing what
    is on file never means handing out the files."""

    def get(self, request, pk):
        document = self.get_queryset().filter(pk=pk).first()
        if document is None:
            raise Http404
        return FileResponse(document.file.open("rb"))


@api_view(["POST"])
@permission_classes([IsOrganizationManager, IsPerson])
def verify_document(request, pk):
    """Mark a scan as checked against the person in front of you."""
    organization = get_current_organization(request)
    document = MemberDocument.objects.filter(
        organization=organization, pk=pk
    ).first()
    if document is None:
        raise Http404

    document.verified_on = timezone.localdate()
    document.verified_by = request.user.id or ""
    document.save(update_fields=["verified_on", "verified_by"])
    return Response(MemberDocumentSerializer(document).data)


@api_view(["GET"])
@permission_classes([IsOrganizationStaff])
def onboarding_meta(request):
    """What the onboarding form needs to build its controls, including the
    upload limits, so the browser can reject an oversized file before
    spending a minute uploading it."""
    return Response(
        {
            "document_kinds": [
                {"value": v, "label": label} for v, label in DocumentKind.CHOICES
            ],
            "max_photo_bytes": Upload.MAX_PHOTO_BYTES,
            "max_document_bytes": Upload.MAX_DOCUMENT_BYTES,
            "photo_types": Upload.PHOTO_TYPES,
            "document_types": Upload.DOCUMENT_TYPES,
        }
    )
