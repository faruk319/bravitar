from datetime import date as date_type
from decimal import Decimal

from django.utils.dateparse import parse_date
from django.utils.text import slugify
from rest_framework import generics, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from exercises.permissions import HasFitnessVertical
from tenants.context import get_current_organization
from tenants.permissions import IsOrganizationStaff, IsPerson

from .constants import Meal
from .models import Food, FoodLogEntry, NutritionPlan
from .serializers import FoodLogEntrySerializer, FoodSerializer, NutritionPlanSerializer


def _requested_date(request):
    """?date=YYYY-MM-DD, defaulting to today."""
    raw = request.query_params.get("date")
    return (parse_date(raw) if raw else None) or date_type.today()


class NutritionScopedMixin:
    permission_classes = [HasFitnessVertical, IsPerson]

    @property
    def academy(self):
        return get_current_organization(self.request)

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "academy": self.academy}


class FoodListCreateView(NutritionScopedMixin, generics.ListCreateAPIView):
    serializer_class = FoodSerializer

    def get_permissions(self):
        if self.request.method == "POST":
            return [HasFitnessVertical(), IsOrganizationStaff()]
        return [HasFitnessVertical()]

    def get_queryset(self):
        queryset = Food.objects.visible_to(self.academy).filter(is_active=True)
        if search := self.request.query_params.get("search"):
            queryset = queryset.filter(name__icontains=search)
        return queryset

    def perform_create(self, serializer):
        academy = self.academy
        base = slugify(serializer.validated_data["name"])[:200] or "food"
        slug = base
        for suffix in range(2, 100):
            if not Food.objects.filter(academy=academy, slug=slug).exists():
                break
            slug = f"{base}-{suffix}"
        serializer.save(academy=academy, slug=slug)


class NutritionPlanView(NutritionScopedMixin, generics.GenericAPIView):
    """The caller's daily macro targets. GET returns the current plan (or
    null); PUT creates or replaces it."""

    serializer_class = NutritionPlanSerializer

    def _plan(self):
        return NutritionPlan.objects.filter(
            academy=self.academy, user_id=self.request.user.id
        ).first()

    def get(self, request):
        plan = self._plan()
        return Response(self.get_serializer(plan).data if plan else None)

    def put(self, request):
        plan = self._plan()
        serializer = self.get_serializer(plan, data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(academy=self.academy, user_id=request.user.id)
        return Response(serializer.data)


class FoodLogListCreateView(NutritionScopedMixin, generics.ListCreateAPIView):
    serializer_class = FoodLogEntrySerializer

    def get_queryset(self):
        return (
            FoodLogEntry.objects.filter(
                academy=self.academy,
                user_id=self.request.user.id,
                consumed_on=_requested_date(self.request),
            )
            .select_related("food")
        )

    def perform_create(self, serializer):
        serializer.save(academy=self.academy, user_id=self.request.user.id)


class FoodLogDetailView(NutritionScopedMixin, generics.RetrieveDestroyAPIView):
    serializer_class = FoodLogEntrySerializer

    def get_queryset(self):
        return FoodLogEntry.objects.filter(
            academy=self.academy, user_id=self.request.user.id
        ).select_related("food")


@api_view(["GET"])
@permission_classes([HasFitnessVertical, IsPerson])
def daily_summary(request):
    """Totals for a day against the caller's targets, plus a per-meal split."""
    academy = get_current_organization(request)
    day = _requested_date(request)

    entries = FoodLogEntry.objects.filter(
        academy=academy, user_id=request.user.id, consumed_on=day
    ).select_related("food")

    zero = Decimal("0.0")
    totals = {"energy_kcal": zero, "protein_g": zero, "carbs_g": zero, "fat_g": zero}
    per_meal = {meal: dict(totals) for meal in Meal.VALUES}

    for entry in entries:
        for key in totals:
            value = getattr(entry, key)
            totals[key] += value
            per_meal[entry.meal][key] += value

    plan = NutritionPlan.objects.filter(
        academy=academy, user_id=request.user.id
    ).first()

    return Response(
        {
            "date": day,
            "totals": totals,
            "per_meal": per_meal,
            "targets": NutritionPlanSerializer(plan).data if plan else None,
            "entry_count": len(entries),
        },
        status=status.HTTP_200_OK,
    )


@api_view(["GET"])
@permission_classes([HasFitnessVertical])
def nutrition_meta(request):
    return Response(
        {"meals": [{"value": v, "label": label} for v, label in Meal.CHOICES]}
    )
