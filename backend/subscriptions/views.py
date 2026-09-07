from datetime import timedelta

from django.db.models import Q
from django.utils import timezone
from rest_framework import generics
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from exercises.permissions import HasGymVertical
from tenants.context import get_current_organization
from tenants.mixins import OrganizationScopedMixin
from tenants.permissions import IsOrganizationManager

from .constants import SubscriptionStatus
from .models import MemberSubscription, MembershipTier
from .serializers import MemberSubscriptionSerializer, MembershipTierSerializer


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


class TierListCreateView(GymScopedMixin, generics.ListCreateAPIView):
    serializer_class = MembershipTierSerializer

    def get_queryset(self):
        queryset = self.scoped(MembershipTier).prefetch_related("subscriptions")
        if self.request.query_params.get("active") == "true":
            queryset = queryset.filter(is_active=True)
        return queryset


class TierDetailView(GymScopedMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = MembershipTierSerializer

    def get_queryset(self):
        return self.scoped(MembershipTier).prefetch_related("subscriptions")

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

    def get_queryset(self):
        queryset = self.scoped(MemberSubscription).select_related("student", "tier")
        params = self.request.query_params

        if student := params.get("student"):
            queryset = queryset.filter(student_id=student)
        if tier := params.get("tier"):
            queryset = queryset.filter(tier_id=tier)

        today = timezone.localdate()
        wanted = params.get("status")
        if wanted == SubscriptionStatus.ACTIVE:
            queryset = queryset.filter(
                cancelled_on__isnull=True, started_on__lte=today, expires_on__gte=today
            )
        elif wanted == SubscriptionStatus.EXPIRED:
            queryset = queryset.filter(cancelled_on__isnull=True, expires_on__lt=today)
        elif wanted == SubscriptionStatus.CANCELLED:
            queryset = queryset.filter(cancelled_on__isnull=False)
        return queryset


class SubscriptionDetailView(GymScopedMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = MemberSubscriptionSerializer

    def get_queryset(self):
        return self.scoped(MemberSubscription).select_related("student", "tier")


@api_view(["GET"])
@permission_classes([HasGymVertical])
def expiring_soon(request):
    """Memberships about to lapse, and the ones that already have.

    This is the list the renewal reminders are built from — a member who
    quietly expires is a member who quietly stops coming.
    """
    organization = get_current_organization(request)
    days = min(int(request.query_params.get("days", SubscriptionStatus.EXPIRING_WINDOW_DAYS)), 60)
    today = timezone.localdate()

    subscriptions = (
        MemberSubscription.objects.filter(organization=organization, cancelled_on__isnull=True)
        .filter(
            Q(expires_on__gte=today - timedelta(days=30), expires_on__lte=today + timedelta(days=days))
        )
        .select_related("student", "tier")
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
    organization = get_current_organization(request)

    subscriptions = list(
        MemberSubscription.objects.filter(organization=organization)
        .select_related("tier")
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
