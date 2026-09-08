"""The gym's class allowance: what the member's current plan includes.

Registered from SubscriptionsConfig.ready(), like the door's admission rule.
Core counts bookings; it doesn't know a membership tier exists.
"""


def classes_per_week(student):
    """The running plan's weekly class credits, or None for unlimited.

    No current membership means no allowance to spend — booking is refused
    earlier for that reason, so this only decides the number.
    """
    from .models import MemberSubscription

    for subscription in MemberSubscription.objects.filter(student=student).with_status():
        if subscription.is_current:
            return subscription.tier.class_credits_per_week
    return None
