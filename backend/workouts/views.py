from django.utils import timezone
from rest_framework import generics, status
from rest_framework.response import Response

from exercises.permissions import HasGymVertical
from tenants.context import get_current_organization

from .models import Routine, SetLog, WorkoutSession
from .serializers import RoutineSerializer, SetLogSerializer, WorkoutSessionSerializer


class GymScopedMixin:
    """Everything here is scoped to the current org, the current user, and
    organizations that actually have the gym vertical."""

    permission_classes = [HasGymVertical]

    @property
    def organization(self):
        return get_current_organization(self.request)

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "organization": self.organization}


class RoutineListCreateView(GymScopedMixin, generics.ListCreateAPIView):
    serializer_class = RoutineSerializer

    def get_queryset(self):
        return (
            Routine.objects.filter(organization=self.organization, user_id=self.request.user.id)
            .prefetch_related("items__exercise")
            .filter(is_archived=False)
        )

    def perform_create(self, serializer):
        serializer.save(organization=self.organization, user_id=self.request.user.id)


class RoutineDetailView(GymScopedMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = RoutineSerializer

    def get_queryset(self):
        return Routine.objects.filter(
            organization=self.organization, user_id=self.request.user.id
        ).prefetch_related("items__exercise")


class WorkoutSessionListCreateView(GymScopedMixin, generics.ListCreateAPIView):
    serializer_class = WorkoutSessionSerializer

    def get_queryset(self):
        return WorkoutSession.objects.filter(
            organization=self.organization, user_id=self.request.user.id
        ).prefetch_related("sets__exercise")

    def perform_create(self, serializer):
        serializer.save(organization=self.organization, user_id=self.request.user.id)


class WorkoutSessionDetailView(GymScopedMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = WorkoutSessionSerializer

    def get_queryset(self):
        return WorkoutSession.objects.filter(
            organization=self.organization, user_id=self.request.user.id
        ).prefetch_related("sets__exercise")


class SetLogCreateView(GymScopedMixin, generics.CreateAPIView):
    """Logs one set against a session the caller owns."""

    serializer_class = SetLogSerializer

    def create(self, request, *args, **kwargs):
        try:
            session = WorkoutSession.objects.get(
                pk=kwargs["session_id"],
                organization=self.organization,
                user_id=request.user.id,
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
                pk=pk, organization=self.organization, user_id=request.user.id
            )
        except WorkoutSession.DoesNotExist:
            return Response({"detail": "Session not found."}, status=status.HTTP_404_NOT_FOUND)

        session.completed_at = timezone.now()
        session.save(update_fields=["completed_at"])
        return Response(self.get_serializer(session).data)
