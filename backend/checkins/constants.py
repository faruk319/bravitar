class CheckInMethod:
    """How the member got through the door.

    `biometric` is here because a fingerprint or face reader is on the roadmap
    and the device will post to the same endpoint the QR scanner does. Nothing
    reads a fingerprint today — the value exists so the column does not have to
    change when a reader is plugged in.
    """

    QR = "qr"
    MANUAL = "manual"
    BIOMETRIC = "biometric"

    CHOICES = [
        (QR, "QR code"),
        (MANUAL, "Front desk"),
        (BIOMETRIC, "Biometric"),
    ]
    VALUES = [value for value, _ in CHOICES]


class Refusal:
    """Why somebody was turned away.

    A refused check-in is still recorded. A gym that turned twelve people away
    this week has a problem worth seeing, and the member who was refused will
    ask why — so the reason is stored, not recomputed later from dates that
    have since moved on.
    """

    NO_MEMBERSHIP = "no_membership"
    AWAITING_PAYMENT = "awaiting_payment"
    EXPIRED = "expired"
    CANCELLED = "cancelled"
    NOT_STARTED = "not_started"

    CHOICES = [
        (NO_MEMBERSHIP, "No membership"),
        (AWAITING_PAYMENT, "Payment not taken"),
        (EXPIRED, "Membership expired"),
        (CANCELLED, "Membership cancelled"),
        (NOT_STARTED, "Membership hasn't started"),
    ]
    VALUES = [value for value, _ in CHOICES]
