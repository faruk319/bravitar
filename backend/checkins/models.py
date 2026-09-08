from django.db import models
from django.utils import timezone

from organizations.models import Branch, Organization
from students.models import Student
from subscriptions.constants import SubscriptionStatus
from subscriptions.models import MemberSubscription

from .constants import CheckInMethod, Refusal


class Admission:
    """The answer to "can this person train right now?", with the reason.

    This is the one place that decision is made. The membership status already
    encodes it — only `active` and `expiring` admit — so this does not invent a
    second rule, it translates the existing one into something the door can act
    on and the desk can read out loud.
    """

    __slots__ = ("allowed", "reason", "subscription")

    def __init__(self, allowed, reason=None, subscription=None):
        self.allowed = allowed
        self.reason = reason
        self.subscription = subscription

    @property
    def message(self):
        if self.allowed:
            return ""
        return dict(Refusal.CHOICES).get(self.reason, "Not allowed in")


# Which refusal a non-admitting membership maps to.
_REFUSALS = {
    SubscriptionStatus.PENDING: Refusal.AWAITING_PAYMENT,
    SubscriptionStatus.EXPIRED: Refusal.EXPIRED,
    SubscriptionStatus.CANCELLED: Refusal.CANCELLED,
    SubscriptionStatus.UPCOMING: Refusal.NOT_STARTED,
}


def admission_for(student):
    """Whether `student` may come in, and on which membership.

    Picks the membership that admits them if there is one; otherwise reports
    the most recent membership's reason, because "expired on the 3rd" is a
    useful thing to say and "no membership" is not, when they had one.
    """
    subscriptions = list(
        MemberSubscription.objects.filter(student=student).with_status()
    )
    if not subscriptions:
        return Admission(False, Refusal.NO_MEMBERSHIP)

    for subscription in subscriptions:
        if subscription.is_current:
            return Admission(True, subscription=subscription)

    # Meta ordering is newest expiry first, so this is the one they will ask
    # about.
    latest = subscriptions[0]
    return Admission(
        False, _REFUSALS.get(latest.status, Refusal.NO_MEMBERSHIP), latest
    )


class CheckIn(models.Model):
    """One visit — or one attempt at a visit.

    Refused attempts are rows too, with `admitted` false. Deleting them would
    make the door look like it never turns anybody away, which is exactly the
    number a gym needs when memberships stop being paid.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="checkins"
    )
    student = models.ForeignKey(
        Student, on_delete=models.CASCADE, related_name="checkins"
    )
    branch = models.ForeignKey(
        Branch, on_delete=models.SET_NULL, related_name="checkins", null=True, blank=True
    )
    subscription = models.ForeignKey(
        MemberSubscription, on_delete=models.SET_NULL,
        related_name="checkins", null=True, blank=True,
        help_text="The membership that admitted them, when one did.",
    )

    checked_in_at = models.DateTimeField(default=timezone.now)
    checked_out_at = models.DateTimeField(null=True, blank=True)

    method = models.CharField(
        max_length=20, choices=CheckInMethod.CHOICES, default=CheckInMethod.MANUAL
    )
    admitted = models.BooleanField(default=True)
    refused_reason = models.CharField(
        max_length=30, choices=Refusal.CHOICES, blank=True
    )
    # Free text so a turnstile or reader can name itself without needing a
    # table of devices before the first one is installed.
    device = models.CharField(max_length=64, blank=True)

    class Meta:
        ordering = ["-checked_in_at", "-id"]
        indexes = [
            models.Index(fields=["organization", "-checked_in_at"]),
            models.Index(fields=["student", "-checked_in_at"]),
        ]

    def __str__(self):
        return f"{self.student.full_name} at {self.checked_in_at:%Y-%m-%d %H:%M}"

    @property
    def is_inside(self):
        return self.admitted and self.checked_out_at is None

    @property
    def minutes(self):
        if self.checked_out_at is None:
            return None
        return int((self.checked_out_at - self.checked_in_at).total_seconds() // 60)

    def check_out(self, at=None):
        self.checked_out_at = at or timezone.now()
        self.save(update_fields=["checked_out_at"])
        return self
