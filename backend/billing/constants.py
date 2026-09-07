class BillingCycle:
    ONE_TIME = "one_time"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    HALF_YEARLY = "half_yearly"
    ANNUAL = "annual"

    CHOICES = [
        (ONE_TIME, "One time"),
        (MONTHLY, "Monthly"),
        (QUARTERLY, "Quarterly"),
        (HALF_YEARLY, "Half yearly"),
        (ANNUAL, "Annual"),
    ]
    VALUES = [value for value, _ in CHOICES]


class InvoiceStatus:
    """Derived from payments and the due date, never set by hand — a stored
    status is the classic way for an invoice to say "paid" while the payments
    say otherwise."""

    UNPAID = "unpaid"
    PARTIAL = "partial"
    PAID = "paid"
    OVERDUE = "overdue"
    CANCELLED = "cancelled"


class PaymentMethod:
    CASH = "cash"
    UPI = "upi"
    CARD = "card"
    BANK = "bank_transfer"
    OTHER = "other"

    CHOICES = [
        (CASH, "Cash"),
        (UPI, "UPI"),
        (CARD, "Card"),
        (BANK, "Bank transfer"),
        (OTHER, "Other"),
    ]
    VALUES = [value for value, _ in CHOICES]
