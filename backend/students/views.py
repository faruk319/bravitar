from django.db.models import Count, Q
from django.db.models.deletion import ProtectedError
from django.http import FileResponse, Http404
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from tenants.branches import allowed_branch_ids
from tenants.context import get_current_academy
from tenants.mixins import OrganizationScopedMixin
from tenants.permissions import IsOrganizationManager, IsOrganizationStaff, IsPerson

from .constants import DocumentKind, Upload
from .models import MemberDocument, MemberTransfer, Student, TransferStatus
from .serializers import (
    MemberDocumentSerializer,
    MemberTransferSerializer,
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
            academy=self.academy,
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
    academy = get_current_academy(request)
    document = MemberDocument.objects.filter(
        academy=academy, pk=pk
    ).first()
    if document is None:
        raise Http404

    document.verified_on = timezone.localdate()
    document.verified_by = request.user.id or ""
    document.save(update_fields=["verified_on", "verified_by"])
    return Response(MemberDocumentSerializer(document).data)


@api_view(["POST"])
@permission_classes([IsOrganizationManager, IsPerson])
def invite_member(request, pk):
    """Let this member sign in, or take that away again.

    Deliberately explicit rather than automatic: an email on a member record
    is a contact detail the desk typed in at sign-up, and turning every one of
    those into a login nobody asked for would hand out access by accident.
    """
    from .invitations import invite, withdraw_invite

    academy = get_current_academy(request)
    student = Student.objects.filter(academy=academy, pk=pk).first()
    if student is None:
        raise Http404

    if request.data.get("allowed") is False:
        withdraw_invite(student)
    elif not invite(student):
        raise ValidationError(
            {"email": f"{student.full_name} has no email address to invite."}
        )

    student.refresh_from_db()
    return Response({
        "invited": student.invited_at is not None,
        "signed_in": bool(student.user_id),
        "email": student.email,
    })


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


class TransferScopedMixin(OrganizationScopedMixin):
    """Moving a member is a manager's call, and a person's — not a key's."""

    serializer_class = MemberTransferSerializer
    permission_classes = [IsOrganizationManager, IsPerson]


class TransferListCreateView(TransferScopedMixin, generics.ListCreateAPIView):
    def get_queryset(self):
        """Both sides of a request need to see it: the branch asking, and the
        branch being asked. Scoping to one would hide it from the other."""
        queryset = MemberTransfer.objects.filter(academy=self.academy).select_related(
            "student", "from_branch", "to_branch"
        )
        allowed = self.allowed_branches
        if allowed is not None:
            queryset = queryset.filter(
                Q(to_branch_id__in=allowed)
                | Q(from_branch_id__in=allowed)
                | Q(from_branch__isnull=True)
            )
        if student := self.request.query_params.get("student"):
            queryset = queryset.filter(student_id=student)
        if self.request.query_params.get("open") == "true":
            queryset = queryset.filter(status=TransferStatus.PENDING)
        return queryset

    def perform_create(self, serializer):
        serializer.save(academy=self.academy, requested_by=self.request.user.id or "")


class TransferDetailView(TransferScopedMixin, generics.RetrieveAPIView):
    def get_queryset(self):
        return MemberTransfer.objects.filter(academy=self.academy).select_related(
            "student", "from_branch", "to_branch"
        )


def _decidable(request, academy, pk):
    """The transfer, if this caller may decide it.

    The branch losing the member decides, or an owner. The branch that asked
    cannot approve its own request — that would make asking pointless.
    """
    transfer = MemberTransfer.objects.filter(
        academy=academy, pk=pk
    ).select_related("student", "from_branch", "to_branch").first()
    if transfer is None or not transfer.is_open:
        return None, Response(
            {"detail": "No open request here."}, status=status.HTTP_404_NOT_FOUND
        )

    allowed = allowed_branch_ids(request, academy)
    if allowed is None:
        return transfer, None  # An owner, or an academy with no branches.
    if transfer.from_branch_id is None or transfer.from_branch_id in allowed:
        return transfer, None
    return None, Response(
        {"detail": "Only the member's current branch can decide this."},
        status=status.HTTP_403_FORBIDDEN,
    )


@api_view(["POST"])
@permission_classes([IsOrganizationManager, IsPerson])
def approve_transfer(request, pk):
    academy = get_current_academy(request)
    transfer, refusal = _decidable(request, academy, pk)
    if refusal:
        return refusal

    transfer.approve(
        by=request.user.id or "", note=request.data.get("note", "")
    )
    return Response(MemberTransferSerializer(transfer).data)


@api_view(["POST"])
@permission_classes([IsOrganizationManager, IsPerson])
def decline_transfer(request, pk):
    academy = get_current_academy(request)
    transfer, refusal = _decidable(request, academy, pk)
    if refusal:
        return refusal

    transfer.close(
        TransferStatus.DECLINED,
        by=request.user.id or "",
        note=request.data.get("note", ""),
    )
    return Response(MemberTransferSerializer(transfer).data)


@api_view(["POST"])
@permission_classes([IsOrganizationManager, IsPerson])
def withdraw_transfer(request, pk):
    """The branch that asked can take its own request back."""
    academy = get_current_academy(request)
    transfer = MemberTransfer.objects.filter(academy=academy, pk=pk).first()
    if transfer is None or not transfer.is_open:
        return Response(
            {"detail": "No open request here."}, status=status.HTTP_404_NOT_FOUND
        )

    allowed = allowed_branch_ids(request, academy)
    if allowed is not None and transfer.to_branch_id not in allowed:
        return Response(
            {"detail": "Only the branch that asked can withdraw it."},
            status=status.HTTP_403_FORBIDDEN,
        )

    transfer.close(TransferStatus.WITHDRAWN, by=request.user.id or "")
    return Response(MemberTransferSerializer(transfer).data)
