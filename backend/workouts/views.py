from datetime import timedelta

from django.db.models import Max
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from exercises.permissions import HasFitnessVertical
from students.owner import named_student
from tenants.context import get_current_academy
from tenants.permissions import IsPerson

from .models import Routine, SetLog, WorkoutSession
from .progression import suggest
from .stats import activity_calendar, muscle_breakdown, training_totals
from .serializers import RoutineSerializer, SetLogSerializer, WorkoutSessionSerializer


class GymScopedMixin:
    """Everything here is scoped to the current org, the current user, and
    organizations that actually have the gym vertical."""

    permission_classes = [HasFitnessVertical, IsPerson]

    @property
    def academy(self):
        return get_current_academy(self.request)

    @property
    def member(self):
        """The member whose records these are. Named, not inferred: a trainer
        opening a plan is not the person it belongs to."""
        return named_student(self.request, self.academy)

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "academy": self.academy}


class RoutineListCreateView(GymScopedMixin, generics.ListCreateAPIView):
    serializer_class = RoutineSerializer

    def get_queryset(self):
        return (
            Routine.objects.filter(academy=self.academy, student=self.member)
            .prefetch_related("items__exercise")
            .filter(is_archived=False)
        )

    def perform_create(self, serializer):
        serializer.save(academy=self.academy, student=self.member)


class RoutineDetailView(GymScopedMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = RoutineSerializer

    def get_queryset(self):
        return Routine.objects.filter(
            academy=self.academy, student=self.member
        ).prefetch_related("items__exercise")


@api_view(["GET"])
@permission_classes([HasFitnessVertical, IsPerson])
def muscle_map(request):
    """Per-muscle training volume over a window, for the balance / fatigue /
    strength views. Warm-ups are excluded — they aren't training volume."""
    academy = get_current_academy(request)
    days = min(int(request.query_params.get("days", 30) or 30), 365)
    since = timezone.now() - timedelta(days=days)

    working_sets = (
        SetLog.objects.filter(
            session__academy=academy,
            session__student=named_student(request, academy),
            session__started_at__gte=since,
            is_warmup=False,
        )
        .select_related("exercise", "session")
    )

    return Response({"days": days, "muscles": muscle_breakdown(list(working_sets))})


@api_view(["GET"])
@permission_classes([HasFitnessVertical, IsPerson])
def activity(request):
    """Sessions per day for a GitHub-style heatmap."""
    academy = get_current_academy(request)
    days = min(int(request.query_params.get("days", 365) or 365), 731)

    end = timezone.localdate()
    start = end - timedelta(days=days - 1)

    sessions = WorkoutSession.objects.filter(
        academy=academy, student=named_student(request, academy)
    )

    return Response(
        {
            "start": start,
            "end": end,
            "days": activity_calendar(sessions, start, end),
            "totals": training_totals(sessions.filter(started_at__date__gte=start)),
        }
    )


class RoutineGuideView(GymScopedMixin, generics.GenericAPIView):
    """Everything needed to run a routine as a guided session: what you did
    last time, what to aim for now, and your best lift so far."""

    serializer_class = RoutineSerializer

    def get(self, request, pk):
        try:
            routine = Routine.objects.prefetch_related("items__exercise").get(
                pk=pk, academy=self.academy
            )
        except Routine.DoesNotExist:
            return Response({"detail": "Routine not found."}, status=status.HTTP_404_NOT_FOUND)

        return Response(
            {
                "routine": {"id": routine.id, "name": routine.name},
                "progression": routine.progression,
                "items": [self._guide_for(item, routine) for item in routine.items.all()],
            }
        )

    def _guide_for(self, item, routine):
        working_sets = SetLog.objects.filter(
            exercise=item.exercise,
            is_warmup=False,
            session__student=self.member,
            session__academy=self.academy,
        )

        last_session_id = (
            working_sets.order_by("-session__started_at")
            .values_list("session_id", flat=True)
            .first()
        )
        last_sets = (
            list(working_sets.filter(session_id=last_session_id).order_by("set_number"))
            if last_session_id
            else []
        )

        suggestion = suggest(item, last_sets, routine.progression, routine.progression_increment)
        best = working_sets.aggregate(best=Max("estimated_1rm"))["best"]

        return {
            "routine_exercise_id": item.id,
            "exercise": {"id": item.exercise.id, "name": item.exercise.name},
            "superset_group": item.superset_group,
            "target_sets": item.target_sets,
            "rest_seconds": item.rest_seconds,
            "last_session": [
                {"set_number": s.set_number, "reps": s.reps, "weight": s.weight, "rir": s.rir}
                for s in last_sets
            ],
            "suggested": suggestion,
            "best_estimated_1rm": best,
        }


class WorkoutSessionListCreateView(GymScopedMixin, generics.ListCreateAPIView):
    serializer_class = WorkoutSessionSerializer

    def get_queryset(self):
        return WorkoutSession.objects.filter(
            academy=self.academy, student=self.member
        ).prefetch_related("sets__exercise")

    def perform_create(self, serializer):
        serializer.save(academy=self.academy, student=self.member)


class WorkoutSessionDetailView(GymScopedMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = WorkoutSessionSerializer

    def get_queryset(self):
        return WorkoutSession.objects.filter(
            academy=self.academy, student=self.member
        ).prefetch_related("sets__exercise")


class SetLogCreateView(GymScopedMixin, generics.CreateAPIView):
    """Logs one set against a session the caller owns."""

    serializer_class = SetLogSerializer

    def create(self, request, *args, **kwargs):
        try:
            session = WorkoutSession.objects.get(
                pk=kwargs["session_id"], academy=self.academy
            )
        except WorkoutSession.DoesNotExist:
            return Response({"detail": "Session not found."}, status=status.HTTP_404_NOT_FOUND)

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(session=session)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class WorkoutSessionCompleteView(GymScopedMixin, generics.GenericAPIView):
    serializer_class = WorkoutSessionSerializer

    def post(self, request, pk):
        try:
            session = WorkoutSession.objects.get(
                pk=pk, academy=self.academy
            )
        except WorkoutSession.DoesNotExist:
            return Response({"detail": "Session not found."}, status=status.HTTP_404_NOT_FOUND)

        session.completed_at = timezone.now()
        session.save(update_fields=["completed_at"])
        return Response(self.get_serializer(session).data)
