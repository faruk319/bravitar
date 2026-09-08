from django.utils.text import slugify
from rest_framework import generics
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from tenants.context import get_current_organization
from tenants.permissions import IsOrganizationStaff

from .constants import Category, Equipment, Muscle
from .models import Exercise
from .permissions import HasFitnessVertical
from .serializers import ExerciseSerializer


def _unique_slug(academy, name):
    base = slugify(name)[:200] or "exercise"
    slug = base
    for suffix in range(2, 100):
        if not Exercise.objects.filter(academy=academy, slug=slug).exists():
            return slug
        slug = f"{base}-{suffix}"
    raise ValueError("Could not generate a unique slug")


class ExerciseListCreateView(generics.ListCreateAPIView):
    serializer_class = ExerciseSerializer

    def get_permissions(self):
        if self.request.method == "POST":
            return [HasFitnessVertical(), IsOrganizationStaff()]
        return [HasFitnessVertical()]

    def get_queryset(self):
        academy = get_current_organization(self.request)
        queryset = Exercise.objects.visible_to(academy).filter(is_active=True)

        params = self.request.query_params
        if search := params.get("search"):
            queryset = queryset.filter(name__icontains=search)
        if muscle := params.get("muscle"):
            queryset = queryset.filter(primary_muscle=muscle)
        if equipment := params.get("equipment"):
            queryset = queryset.filter(equipment=equipment)
        if category := params.get("category"):
            queryset = queryset.filter(category=category)
        return queryset

    def perform_create(self, serializer):
        academy = get_current_organization(self.request)
        serializer.save(
            academy=academy,
            slug=_unique_slug(academy, serializer.validated_data["name"]),
        )


class ExerciseDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = ExerciseSerializer

    def get_permissions(self):
        if self.request.method in ("PUT", "PATCH", "DELETE"):
            return [HasFitnessVertical(), IsOrganizationStaff()]
        return [HasFitnessVertical()]

    def get_queryset(self):
        academy = get_current_organization(self.request)
        if self.request.method in ("PUT", "PATCH", "DELETE"):
            # The shared library is read-only; only your own exercises are editable.
            return Exercise.objects.filter(academy=academy)
        return Exercise.objects.visible_to(academy)


@api_view(["GET"])
@permission_classes([HasFitnessVertical])
def exercise_meta(request):
    """Vocabulary for building filter and form controls on the frontend."""
    return Response(
        {
            "muscles": [{"value": v, "label": label} for v, label in Muscle.CHOICES],
            "equipment": [{"value": v, "label": label} for v, label in Equipment.CHOICES],
            "categories": [{"value": v, "label": label} for v, label in Category.CHOICES],
        }
    )
