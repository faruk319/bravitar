from datetime import timedelta
from decimal import Decimal

from django.db import models
from django.db.models.functions import Coalesce
from django.utils import timezone

from organizations.models import Organization
from students.models import Student

from .constants import BillingPeriod, SubscriptionStatus


class MemberSubscriptionQuerySet(models.QuerySet):
    """Status is derived from three places — the dates, the organization's
    payment policy, and the invoice's payments — so reading it off a plain
    queryset costs three extra queries per row. These helpers load it in one
    go, and translate a status back into something the database can filter on.
    """

    def with_status(self):
        return self.select_related("organization", "invoice").prefetch_related(
            "invoice__payments"
        )

    def _with_paid(self):
        # An aggregate annotation drops the model's default ordering, and an
        # unordered queryset makes pagination skip and repeat rows. Put it back.
        return self.annotate(
            _paid=Coalesce(
                models.Sum("invoice__payments__amount"),
                models.Value(Decimal("0")),
                output_field=models.DecimalField(max_digits=12, decimal_places=2),
            )
        ).order_by(*MemberSubscription._meta.ordering)

    def awaiting_payment(self, organization):
        """Live memberships that nobody has paid a rupee towards."""
        if not organization.membership_requires_payment:
            return self.none()
        return self._with_paid().filter(
            cancelled_on__isnull=True,
            expires_on__gte=timezone.localdate(),
            invoice__isnull=False,
            invoice__is_cancelled=False,
            _paid__lte=0,
        )

    def by_status(self, wanted, organization):
        """Filter to one derived status, in SQL, so pagination still counts
        the right rows. Anything unrecognised leaves the queryset alone."""
        today = timezone.localdate()

        if wanted == SubscriptionStatus.CANCELLED:
            return self.filter(cancelled_on__isnull=False)
        if wanted == SubscriptionStatus.EXPIRED:
            return self.filter(cancelled_on__isnull=True, expires_on__lt=today)
        if wanted == SubscriptionStatus.PENDING:
            return self.awaiting_payment(organization)

        if wanted in (SubscriptionStatus.ACTIVE, SubscriptionStatus.UPCOMING):
            queryset = self.filter(cancelled_on__isnull=True, expires_on__gte=today)
            if wanted == SubscriptionStatus.ACTIVE:
                queryset = queryset.filter(started_on__lte=today)
            else:
                queryset = queryset.filter(started_on__gt=today)
            # Unpaid memberships read as "pending", not as either of these.
            unpaid = self.awaiting_payment(organization).values("pk")
            return queryset.exclude(pk__in=unpaid)
        return self


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

    # Selling a membership raises an invoice, and this points at it. Without
    # that link the Memberships screen and Fees & Billing show two unrelated
    # sets of numbers, which is exactly how it read before.
    invoice = models.OneToOneField(
        "billing.Invoice", on_delete=models.SET_NULL,
        related_name="subscription", null=True, blank=True,
    )

    cancelled_on = models.DateField(null=True, blank=True)
    notes = models.CharField(max_length=255, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    objects = MemberSubscriptionQuerySet.as_manager()

    class Meta:
        ordering = ["-expires_on", "-id"]
        indexes = [models.Index(fields=["organization", "expires_on"])]

    def __str__(self):
        return f"{self.student.full_name} on {self.tier.name} to {self.expires_on}"

    @property
    def awaiting_payment(self):
        """True when the gym takes payment up front and none has arrived.

        Deliberately keyed on *nothing* paid rather than a balance owing: once
        a member has handed over any amount they have committed, so they train
        and the remainder is chased on the billing screen. That keeps the line
        easy to say out loud — "not a rupee in yet" — instead of turning the
        front desk into a debt calculation.
        """
        if not self.organization.membership_requires_payment:
            return False
        if self.invoice is None or self.invoice.is_cancelled:
            # No bill to settle — either legacy data or a waived membership.
            return False
        return self.invoice.amount_paid <= 0

    @property
    def status(self):
        if self.cancelled_on:
            return SubscriptionStatus.CANCELLED

        today = timezone.localdate()
        # Expiry outranks payment: once the dates are gone the membership is
        # over whether or not it was ever paid for. The money is still owed,
        # but it is billing's problem, not an access decision.
        if self.expires_on < today:
            return SubscriptionStatus.EXPIRED
        if self.awaiting_payment:
            return SubscriptionStatus.PENDING
        if self.started_on > today:
            return SubscriptionStatus.UPCOMING
        if self.days_remaining <= SubscriptionStatus.EXPIRING_WINDOW_DAYS:
            return SubscriptionStatus.EXPIRING
        return SubscriptionStatus.ACTIVE

    @property
    def days_remaining(self):
        return (self.expires_on - timezone.localdate()).days

    @property
    def is_current(self):
        """Whether this membership entitles the member to walk in today."""
        return self.status in SubscriptionStatus.ADMITTING

    @classmethod
    def expiry_for(cls, tier, started_on):
        # Inclusive of the start day: a 30-day plan bought on the 1st runs to
        # the 30th, not the 31st.
        return started_on + timedelta(days=tier.duration_days - 1)

    def raise_invoice(self):
        """Bills this membership, so the money shows up where money lives.

        Payment is due the day the membership starts — a gym takes the fee
        up front, and a backdated membership is one that should already have
        been paid for.
        """
        from billing.models import Invoice

        if self.invoice_id:
            return self.invoice

        invoice = Invoice.objects.create(
            organization=self.organization,
            student=self.student,
            amount=self.price_paid,
            issued_on=self.started_on,
            due_on=self.started_on,
            period_start=self.started_on,
            period_end=self.expires_on,
            description=f"{self.tier.name} membership — {self.started_on} to {self.expires_on}",
        )
        self.invoice = invoice
        self.save(update_fields=["invoice"])
        return invoice

    def cancel(self, on=None):
        """Ends the membership, and drops its bill if nothing was paid.

        A part-paid membership keeps its invoice: real money has changed
        hands, and whether that becomes a refund or a credit is a decision
        for a person, not something to quietly automate away.
        """
        self.cancelled_on = on or timezone.localdate()
        self.save(update_fields=["cancelled_on"])

        invoice = self.invoice
        if invoice and not invoice.is_cancelled and invoice.amount_paid == 0:
            invoice.is_cancelled = True
            invoice.save(update_fields=["is_cancelled"])
        return self

    @classmethod
    def current_for(cls, student):
        """The subscription that counts today, if any."""
        return next(
            (s for s in student.subscriptions.select_related("tier") if s.is_current),
            None,
        )
