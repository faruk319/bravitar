from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Prefetch, Q
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import generics
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from exercises.permissions import HasGymVertical
from tenants.context import get_current_academy
from tenants.mixins import OrganizationScopedMixin
from tenants.permissions import IsOrganizationManager, IsPerson

from .constants import SubscriptionStatus
from .models import MemberSubscription, MembershipTier
from .trainers import TrainerAssignment
from .serializers import (
    MemberSubscriptionSerializer,
    MembershipTierSerializer,
    TrainerAssignmentSerializer,
)


class GymScopedMixin(OrganizationScopedMixin):
    """Gym operations: anyone running the academy can look, managers change.

    Tiers and memberships are the academy's commercial terms, so they sit with
    the same people who handle invoices rather than with whoever takes the
    class.
    """

    permission_classes = [HasGymVertical]

    def get_permissions(self):
        if self.request.method not in ("GET", "HEAD", "OPTIONS"):
            return [HasGymVertical(), IsOrganizationManager()]
        return [HasGymVertical()]


def _tier_subscriptions():
    """Tier cards report how many members are current, and "current" now reads
    the academy's payment policy and the invoice behind each membership."""
    return Prefetch("subscriptions", queryset=MemberSubscription.objects.with_status())


class TierListCreateView(GymScopedMixin, generics.ListCreateAPIView):
    serializer_class = MembershipTierSerializer

    def get_queryset(self):
        queryset = self.scoped(MembershipTier).prefetch_related(_tier_subscriptions())
        if self.request.query_params.get("active") == "true":
            queryset = queryset.filter(is_active=True)
        return queryset


class TierDetailView(GymScopedMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = MembershipTierSerializer

    def get_queryset(self):
        return self.scoped(MembershipTier).prefetch_related(_tier_subscriptions())

    def perform_destroy(self, instance):
        """Subscriptions PROTECT their tier, so a tier anyone has ever been on
        can't be deleted. Retiring it keeps that history readable while taking
        it off the list of what can be sold."""
        from rest_framework.exceptions import ValidationError

        if instance.subscriptions.exists():
            raise ValidationError({"detail": (
                f"{instance.name} has memberships on it. Switch it off instead "
                "of deleting, so past memberships still make sense."
            )})
        instance.delete()


class SubscriptionListCreateView(GymScopedMixin, generics.ListCreateAPIView):
    serializer_class = MemberSubscriptionSerializer

    @transaction.atomic
    def perform_create(self, serializer):
        """Selling a membership bills for it, so Memberships and Fees &
        Billing are two views of the same money rather than two tallies that
        never meet."""
        subscription = serializer.save(academy=self.academy)
        subscription.raise_invoice()

    def get_queryset(self):
        queryset = (
            self.scoped(MemberSubscription).select_related("student", "tier").with_status()
        )
        params = self.request.query_params

        if student := params.get("student"):
            queryset = queryset.filter(student_id=student)
        if tier := params.get("tier"):
            queryset = queryset.filter(tier_id=tier)
        if wanted := params.get("status"):
            queryset = queryset.by_status(wanted, self.academy)
        return queryset


class SubscriptionDetailView(GymScopedMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = MemberSubscriptionSerializer

    def get_queryset(self):
        return (
            self.scoped(MemberSubscription).select_related("student", "tier").with_status()
        )

    @transaction.atomic
    def perform_update(self, serializer):
        """Cancelling goes through the model so an unpaid bill is dropped
        with it rather than left chasing someone who has left."""
        was_cancelled = serializer.instance.cancelled_on
        subscription = serializer.save()
        if subscription.cancelled_on and not was_cancelled:
            subscription.cancel(on=subscription.cancelled_on)


@api_view(["GET"])
@permission_classes([HasGymVertical])
def expiring_soon(request):
    """Memberships about to lapse, and the ones that already have.

    This is the list the renewal reminders are built from — a member who
    quietly expires is a member who quietly stops coming.
    """
    academy = get_current_academy(request)
    days = min(int(request.query_params.get("days", SubscriptionStatus.EXPIRING_WINDOW_DAYS)), 60)
    today = timezone.localdate()

    subscriptions = (
        MemberSubscription.objects.filter(academy=academy, cancelled_on__isnull=True)
        .filter(
            Q(expires_on__gte=today - timedelta(days=30), expires_on__lte=today + timedelta(days=days))
        )
        .select_related("student", "tier")
        .with_status()
        .order_by("expires_on")
    )

    def row(subscription):
        return {
            "id": subscription.id,
            "student": subscription.student_id,
            "student_name": subscription.student.full_name,
            "phone": subscription.student.phone,
            "email": subscription.student.email,
            "tier_name": subscription.tier.name,
            "expires_on": subscription.expires_on,
            "days_remaining": subscription.days_remaining,
            "status": subscription.status,
        }

    rows = [row(s) for s in subscriptions]
    return Response({
        "window_days": days,
        "expiring": [r for r in rows if r["days_remaining"] >= 0],
        "expired": [r for r in rows if r["days_remaining"] < 0],
    })


@api_view(["GET"])
@permission_classes([HasGymVertical])
def membership_overview(request):
    """How the membership base looks right now: who is current, who lapsed,
    and what each tier is carrying."""
    academy = get_current_academy(request)

    subscriptions = list(
        MemberSubscription.objects.filter(academy=academy)
        .select_related("tier")
        .with_status()
    )

    counts = {value: 0 for value, _ in SubscriptionStatus.CHOICES}
    per_tier = {}
    recurring_value = 0

    for subscription in subscriptions:
        counts[subscription.status] = counts.get(subscription.status, 0) + 1
        if subscription.is_current:
            entry = per_tier.setdefault(
                subscription.tier_id,
                {"tier": subscription.tier_id, "tier_name": subscription.tier.name,
                 "members": 0, "value": 0},
            )
            entry["members"] += 1
            entry["value"] += float(subscription.price_paid)
            recurring_value += float(subscription.price_paid)

    return Response({
        "counts": counts,
        "current_members": counts.get(SubscriptionStatus.ACTIVE, 0)
        + counts.get(SubscriptionStatus.EXPIRING, 0),
        "per_tier": sorted(per_tier.values(), key=lambda t: -t["members"]),
        "value_on_current_memberships": round(recurring_value, 2),
    })


class TrainerScopedMixin(GymScopedMixin):
    serializer_class = TrainerAssignmentSerializer


class TrainerAssignmentListCreateView(TrainerScopedMixin, generics.ListCreateAPIView):
    def get_queryset(self):
        queryset = self.scoped(TrainerAssignment).select_related("trainer", "student")
        params = self.request.query_params
        if trainer := params.get("trainer"):
            queryset = queryset.filter(trainer_id=trainer)
        if student := params.get("student"):
            queryset = queryset.filter(student_id=student)
        if params.get("running") == "true":
            queryset = queryset.filter(ended_on__isnull=True)
        return queryset


class TrainerAssignmentDetailView(TrainerScopedMixin, generics.RetrieveUpdateAPIView):
    def get_queryset(self):
        return self.scoped(TrainerAssignment).select_related("trainer", "student")


@api_view(["GET"])
@permission_classes([HasGymVertical, IsOrganizationManager, IsPerson])
def trainer_earnings(request):
    """What each trainer earned in a month.

    Counted on payments received, not on invoices raised — a cut of a bill
    nobody has paid is a promise, not earnings.
    """
    academy = get_current_academy(request)
    start = parse_date(request.query_params.get("from", "")) or timezone.localdate().replace(day=1)
    end = parse_date(request.query_params.get("to", "")) or _end_of_month(start)

    rows = {}
    assignments = TrainerAssignment.objects.filter(
        academy=academy
    ).select_related("trainer", "student")

    for assignment in assignments:
        earned = assignment.earned_between(start, end)
        entry = rows.setdefault(
            assignment.trainer_id,
            {
                "trainer": assignment.trainer_id,
                "trainer_email": assignment.trainer.email,
                "clients": 0,
                "earned": Decimal("0.00"),
            },
        )
        if assignment.is_running:
            entry["clients"] += 1
        entry["earned"] += earned

    return Response({
        "from": start,
        "to": end,
        "trainers": sorted(rows.values(), key=lambda r: -r["earned"]),
        "total": sum((r["earned"] for r in rows.values()), Decimal("0.00")),
    })


def _end_of_month(day):
    from calendar import monthrange

    return day.replace(day=monthrange(day.year, day.month)[1])
