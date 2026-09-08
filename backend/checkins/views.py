import uuid

from django.db.models import Count, Q
from django.http import FileResponse, Http404
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import generics, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from exercises.permissions import HasGymVertical
from organizations.models import Branch
from students.models import Student
from tenants.context import get_current_organization
from tenants.mixins import OrganizationScopedMixin
from tenants.permissions import IsOrganizationManager, IsOrganizationStaff, IsPerson

from .constants import CheckInMethod
from .models import CheckIn, admission_for
from .serializers import CheckInSerializer, MemberPassSerializer, ScanSerializer


def _open_visit(student):
    """An existing visit they haven't checked out of.

    Scanning twice on the way in is normal — the reader beeps, nobody is sure
    it worked, they scan again. That should be the same visit, not two.
    """
    return CheckIn.objects.filter(
        student=student, admitted=True, checked_out_at__isnull=True
    ).order_by("-checked_in_at").first()


def record_check_in(organization, student, *, method, device="", branch=None):
    """The one path a check-in is created by, whoever asked.

    Returns (check_in, created). A refused attempt is still recorded, so the
    number of people turned away is a number the gym can see.
    """
    existing = _open_visit(student)
    if existing is not None:
        return existing, False

    admission = admission_for(student)
    check_in = CheckIn.objects.create(
        organization=organization,
        student=student,
        branch=branch or student.branch,
        subscription=admission.subscription if admission.allowed else None,
        method=method,
        admitted=admission.allowed,
        refused_reason="" if admission.allowed else admission.reason,
        device=device,
    )
    return check_in, True


class CheckInScopedMixin(OrganizationScopedMixin):
    """Check-ins belong to the gym vertical, and to people — not to API keys,
    which have their own door endpoint below."""

    serializer_class = CheckInSerializer
    permission_classes = [HasGymVertical, IsOrganizationStaff, IsPerson]


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
        """Checking somebody in at the desk.

        A refused attempt still returns 201 with `admitted: false` — it was
        recorded, which is what happened. The screen reads `admitted` and says
        why; it does not need an error to know somebody was turned away.
        """
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        check_in, created = record_check_in(
            self.organization,
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
        # Deleting a visit rewrites the door's history, so it is a manager's
        # decision — a mis-scan is the only honest reason to.
        if self.request.method == "DELETE":
            return [HasGymVertical(), IsOrganizationManager(), IsPerson()]
        return super().get_permissions()


@api_view(["POST"])
@permission_classes([HasGymVertical, IsOrganizationStaff, IsPerson])
def check_out(request, pk):
    organization = get_current_organization(request)
    check_in = CheckIn.objects.filter(organization=organization, pk=pk).first()
    if check_in is None:
        return Response({"detail": "No such visit."}, status=status.HTTP_404_NOT_FOUND)
    if check_in.checked_out_at is not None:
        return Response(CheckInSerializer(check_in).data)
    return Response(CheckInSerializer(check_in.check_out()).data)


@api_view(["POST"])
@permission_classes([HasGymVertical])
def scan(request):
    """The door.

    Open to API keys as well as people, because the thing calling this is a
    tablet at the turnstile or a reader on the wall, not somebody signed in.
    It takes a pass token and nothing else identifying — a scanner that could
    check in an arbitrary member id would be a scanner worth stealing.
    """
    organization = get_current_organization(request)
    serializer = ScanSerializer(data=request.data, context={"organization": organization})
    serializer.is_valid(raise_exception=True)

    student = serializer.context["student"]
    branch = None
    if branch_id := serializer.validated_data.get("branch"):
        branch = Branch.objects.filter(organization=organization, pk=branch_id).first()

    check_in, created = record_check_in(
        organization, student,
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
@permission_classes([HasGymVertical, IsOrganizationStaff, IsPerson])
def today(request):
    """What the front desk wants on a screen: who is in, how busy it has been,
    and who got turned away."""
    organization = get_current_organization(request)
    on = parse_date(request.query_params.get("date", "")) or timezone.localdate()

    visits = CheckIn.objects.filter(
        organization=organization, checked_in_at__date=on
    ).select_related("student", "subscription__tier")

    # Aliases can't reuse a field name — `admitted=Count(...)` collides with
    # the column and Django refuses it.
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
@permission_classes([HasGymVertical, IsOrganizationStaff, IsPerson])
def admission(request, pk):
    """Can this member come in, and if not, why? Answered without recording a
    visit, so the desk can check before the member is standing there."""
    organization = get_current_organization(request)
    student = Student.objects.filter(organization=organization, pk=pk).first()
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
    """A member's pass token, one member at a time.

    POST reissues it, which is what you do when a pass has been photographed
    and passed around — the old QR stops working immediately.
    """

    serializer_class = MemberPassSerializer
    permission_classes = [HasGymVertical, IsOrganizationStaff, IsPerson]

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
    """The pass as a PNG, so it can be printed or shown on a phone.

    Rendered server-side rather than in the browser: the pass is the same
    image whether it is printed at the desk, emailed, or shown on a screen,
    and a printable card should not depend on a script running.
    """

    def get(self, request, pk):
        import io

        import qrcode

        student = self.student()
        image = qrcode.make(str(student.qr_token), box_size=8, border=2)

        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        buffer.seek(0)

        response = FileResponse(buffer, content_type="image/png")
        # The token is the secret; a cached pass image on a shared front-desk
        # machine is one more copy of it lying around.
        response["Cache-Control"] = "no-store"
        return response

    def post(self, request, pk):
        raise Http404
