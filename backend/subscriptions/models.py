from datetime import timedelta

from django.db import models
from django.utils import timezone

from organizations.models import Organization
from students.models import Student

from .constants import BillingPeriod, SubscriptionStatus


class MembershipTier(models.Model):
    """A plan a member can be on — Monthly, Quarterly, Yearly, VIP.

    Named `MembershipTier` rather than `Membership` because that name is
    already taken by a *login* in the organizations app. This one is what a
    member buys; that one is who can sign in.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="membership_tiers"
    )
    name = models.CharField(max_length=100)
    description = models.CharField(max_length=500, blank=True)

    period = models.CharField(
        max_length=20, choices=BillingPeriod.CHOICES, default=BillingPeriod.MONTHLY
    )
    duration_days = models.PositiveSmallIntegerField(
        help_text="How long a subscription on this tier lasts."
    )
    price = models.DecimalField(max_digits=10, decimal_places=2)

    # What the tier actually gets you, so a VIP plan is more than a price.
    includes_personal_trainer = models.BooleanField(default=False)
    class_credits_per_week = models.PositiveSmallIntegerField(
        null=True, blank=True,
        help_text="Bookable class slots per week. Blank means unlimited.",
    )
    perks = models.JSONField(
        default=list, blank=True, help_text="Free-text perks shown on the plan."
    )

    is_active = models.BooleanField(default=True)
    position = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "price", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "name"], name="unique_tier_name_per_org"
            )
        ]

    def __str__(self):
        return f"{self.name} ({self.price})"

    def save(self, *args, **kwargs):
        # A named period implies its length; only "custom" sets its own.
        if self.period != BillingPeriod.CUSTOM:
            self.duration_days = BillingPeriod.DAYS.get(self.period, self.duration_days)
        super().save(*args, **kwargs)


class MemberSubscription(models.Model):
    """One member's stint on a tier, with a start and an end.

    Everything else in the gym hangs off this: whether they can walk in, how
    many classes they may book, and when to remind them to renew.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="subscriptions"
    )
    student = models.ForeignKey(
        Student, on_delete=models.CASCADE, related_name="subscriptions"
    )
    tier = models.ForeignKey(
        MembershipTier, on_delete=models.PROTECT, related_name="subscriptions"
    )

    started_on = models.DateField()
    expires_on = models.DateField()
    price_paid = models.DecimalField(max_digits=10, decimal_places=2)

    # Money lives in the billing app; this just points at the invoice raised
    # for the subscription rather than growing its own payment tracking.
    invoice = models.OneToOneField(
        "billing.Invoice", on_delete=models.SET_NULL,
        related_name="subscription", null=True, blank=True,
    )

    cancelled_on = models.DateField(null=True, blank=True)
    notes = models.CharField(max_length=255, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-expires_on", "-id"]
        indexes = [models.Index(fields=["organization", "expires_on"])]

    def __str__(self):
        return f"{self.student.full_name} on {self.tier.name} to {self.expires_on}"

    @property
    def status(self):
        if self.cancelled_on:
            return SubscriptionStatus.CANCELLED

        today = timezone.localdate()
        if self.started_on > today:
            return SubscriptionStatus.UPCOMING
        if self.expires_on < today:
            return SubscriptionStatus.EXPIRED
        if self.days_remaining <= SubscriptionStatus.EXPIRING_WINDOW_DAYS:
            return SubscriptionStatus.EXPIRING
        return SubscriptionStatus.ACTIVE

    @property
    def days_remaining(self):
        return (self.expires_on - timezone.localdate()).days

    @property
    def is_current(self):
        """Whether this membership entitles the member to walk in today."""
        return self.status in (SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRING)

    @classmethod
    def expiry_for(cls, tier, started_on):
        # Inclusive of the start day: a 30-day plan bought on the 1st runs to
        # the 30th, not the 31st.
        return started_on + timedelta(days=tier.duration_days - 1)

    @classmethod
    def current_for(cls, student):
        """The subscription that counts today, if any."""
        return next(
            (s for s in student.subscriptions.select_related("tier") if s.is_current),
            None,
        )
