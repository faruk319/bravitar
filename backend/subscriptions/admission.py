"""The gym's door rule. Translates membership status into a refusal reason —
it does not define "allowed" a second time."""

from attendance.admission import Admission, Refusal

from .constants import SubscriptionStatus

_REFUSALS = {
    SubscriptionStatus.PENDING: Refusal.AWAITING_PAYMENT,
    SubscriptionStatus.EXPIRED: Refusal.EXPIRED,
    SubscriptionStatus.CANCELLED: Refusal.CANCELLED,
    SubscriptionStatus.UPCOMING: Refusal.NOT_STARTED,
}


def membership_admission(student):
    from .models import MemberSubscription

    subscriptions = list(
        MemberSubscription.objects.filter(student=student).with_status()
    )
    if not subscriptions:
        return Admission(False, Refusal.NO_MEMBERSHIP)

    for subscription in subscriptions:
        if subscription.is_current:
            return Admission(True, subscription=subscription)

    # Newest expiry first: "expired on the 3rd" beats "no membership".
    latest = subscriptions[0]
    return Admission(
        False, _REFUSALS.get(latest.status, Refusal.NO_MEMBERSHIP), latest
    )
