from django.db.models import Count, Q
from rest_framework import generics
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from students.models import Student
from tenants.context import get_current_organization
from tenants.mixins import OrganizationScopedMixin
from tenants.permissions import IsOrganizationStaff

from .constants import BoutResult, GradingResultChoice
from .models import Belt, Bout, Grading, GradingResult
from .permissions import HasKarateVertical
from .serializers import BeltSerializer, BoutSerializer, GradingResultSerializer, GradingSerializer


class KarateScopedMixin(OrganizationScopedMixin):
    permission_classes = [HasKarateVertical]

    def get_permissions(self):
        if self.request.method not in ("GET", "HEAD", "OPTIONS"):
            return [HasKarateVertical(), IsOrganizationStaff()]
        return [HasKarateVertical()]


class BeltListCreateView(KarateScopedMixin, generics.ListCreateAPIView):
    serializer_class = BeltSerializer

    def get_queryset(self):
        return self.scoped(Belt)


class GradingListCreateView(KarateScopedMixin, generics.ListCreateAPIView):
    serializer_class = GradingSerializer

    def get_queryset(self):
        return self.scoped(Grading).select_related("belt", "branch").prefetch_related(
            "results__student"
        )


class GradingDetailView(KarateScopedMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = GradingSerializer

    def get_queryset(self):
        return self.scoped(Grading).select_related("belt", "branch").prefetch_related(
            "results__student"
        )


class GradingResultListCreateView(KarateScopedMixin, generics.ListCreateAPIView):
    serializer_class = GradingResultSerializer

    def get_queryset(self):
        queryset = GradingResult.objects.filter(
            grading__academy=self.academy
        ).select_related("student", "grading")
        if grading := self.request.query_params.get("grading"):
            queryset = queryset.filter(grading_id=grading)
        return queryset

    def perform_create(self, serializer):
        # Scope comes from the grading and the student, both validated.
        serializer.save()


class BoutListCreateView(KarateScopedMixin, generics.ListCreateAPIView):
    serializer_class = BoutSerializer

    def get_queryset(self):
        queryset = self.scoped(Bout).select_related("student")
        if student := self.request.query_params.get("student"):
            queryset = queryset.filter(student_id=student)
        return queryset


class BoutDetailView(KarateScopedMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = BoutSerializer

    def get_queryset(self):
        return self.scoped(Bout).select_related("student")


@api_view(["GET"])
@permission_classes([HasKarateVertical])
def belt_standings(request):
    """Each student's current belt and sparring record.

    Current belt is the highest-position belt they have *passed* — derived,
    not stored, so correcting a grading result corrects the belt too.
    """
    academy = get_current_organization(request)

    belts = {b.id: b for b in Belt.objects.filter(academy=academy)}

    best = {}
    for result in GradingResult.objects.filter(
        grading__academy=academy, result=GradingResultChoice.PASS
    ).select_related("grading"):
        belt = belts.get(result.grading.belt_id)
        if belt is None:
            continue
        current = best.get(result.student_id)
        if current is None or belt.position > current.position:
            best[result.student_id] = belt

    records = {
        row["student"]: row
        for row in Bout.objects.filter(academy=academy)
        .values("student")
        .annotate(
            wins=Count("id", filter=Q(result=BoutResult.WIN)),
            losses=Count("id", filter=Q(result=BoutResult.LOSS)),
            draws=Count("id", filter=Q(result=BoutResult.DRAW)),
        )
    }

    rows = []
    for student in Student.objects.filter(academy=academy):
        belt = best.get(student.id)
        record = records.get(student.id, {})
        wins, losses = record.get("wins", 0), record.get("losses", 0)
        fought = wins + losses + record.get("draws", 0)
        if belt is None and fought == 0:
            continue
        rows.append({
            "student": student.id,
            "student_name": student.full_name,
            "belt": belt.name if belt else None,
            "belt_colour": belt.colour if belt else None,
            "belt_position": belt.position if belt else -1,
            "wins": wins, "losses": losses, "draws": record.get("draws", 0),
            "bouts": fought,
            "win_rate": round(wins / fought, 3) if fought else None,
        })

    rows.sort(key=lambda r: (-r["belt_position"], r["student_name"]))
    return Response({"students": rows})
