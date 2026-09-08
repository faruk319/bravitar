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
    """Derived from the dates and the money, never stored — a stored status is
    how a membership ends up claiming it is active a month after it lapsed.

    One word answers one question: **can this person train today?** Only
    `active` and `expiring` mean yes. The others each say why not, and each
    points at a different fix:

        pending    nobody has paid yet          -> collect the payment
        upcoming   paid, but starts later       -> wait
        expiring   running out within 5 days    -> sell the renewal
        expired    the dates ran out            -> sell a new membership
        cancelled  called off                   -> nothing

    `pending` only exists for organizations that take payment before access
    (Academy.membership_requires_payment). A gym that lets regulars pay
    later switches it off, and then a membership is live from its start date
    with the balance owing shown on the billing screen instead.
    """

    PENDING = "pending"
    UPCOMING = "upcoming"
    ACTIVE = "active"
    EXPIRING = "expiring"
    EXPIRED = "expired"
    CANCELLED = "cancelled"

    CHOICES = [
        (PENDING, "Awaiting payment"),
        (UPCOMING, "Upcoming"),
        (ACTIVE, "Active"),
        (EXPIRING, "Expiring soon"),
        (EXPIRED, "Expired"),
        (CANCELLED, "Cancelled"),
    ]

    # The two states that let somebody through the door.
    ADMITTING = [ACTIVE, EXPIRING]

    # A membership counts as "expiring" this many days out. This is the window
    # the renewal reminders work from.
    EXPIRING_WINDOW_DAYS = 5
