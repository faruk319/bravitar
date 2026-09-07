class BillingPeriod:
    """How long a tier runs for. Stored as days so expiry is simple
    arithmetic and a custom length is possible without a new choice."""

    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    HALF_YEARLY = "half_yearly"
    YEARLY = "yearly"
    CUSTOM = "custom"

    CHOICES = [
        (MONTHLY, "Monthly"),
        (QUARTERLY, "Quarterly"),
        (HALF_YEARLY, "Half yearly"),
        (YEARLY, "Yearly"),
        (CUSTOM, "Custom"),
    ]
    VALUES = [value for value, _ in CHOICES]

    DAYS = {MONTHLY: 30, QUARTERLY: 90, HALF_YEARLY: 180, YEARLY: 365}


class SubscriptionStatus:
    """Derived from the dates, never stored — a stored status is how a
    membership ends up claiming it is active a month after it lapsed."""

    UPCOMING = "upcoming"
    ACTIVE = "active"
    EXPIRING = "expiring"
    EXPIRED = "expired"
    CANCELLED = "cancelled"

    CHOICES = [
        (UPCOMING, "Upcoming"),
        (ACTIVE, "Active"),
        (EXPIRING, "Expiring soon"),
        (EXPIRED, "Expired"),
        (CANCELLED, "Cancelled"),
    ]

    # A membership counts as "expiring" this many days out. This is the window
    # the renewal reminders work from.
    EXPIRING_WINDOW_DAYS = 5
