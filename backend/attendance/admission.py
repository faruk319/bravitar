"""Whether somebody may come in today. Core; verticals register their own rule."""

from students.constants import StudentStatus


class Refusal:
    """Why somebody was turned away. Stored, not recomputed — the dates it came
    from will have moved on by the time anyone asks."""

    NOT_ENROLLED = "not_enrolled"
    NO_MEMBERSHIP = "no_membership"
    AWAITING_PAYMENT = "awaiting_payment"
    EXPIRED = "expired"
    CANCELLED = "cancelled"
    NOT_STARTED = "not_started"

    CHOICES = [
        (NOT_ENROLLED, "No longer enrolled"),
        (NO_MEMBERSHIP, "No membership"),
        (AWAITING_PAYMENT, "Payment not taken"),
        (EXPIRED, "Membership expired"),
        (CANCELLED, "Membership cancelled"),
        (NOT_STARTED, "Membership hasn't started"),
    ]
    VALUES = [value for value, _ in CHOICES]


class Admission:
    """The verdict, plus what it was decided from."""

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


# vertical -> callable(student) -> Admission or None ("no opinion").
_RULES = {}


def register_rule(vertical, rule):
    """Called from a plugin's AppConfig.ready(); core never imports a plugin."""
    _RULES[vertical] = rule


def admission_for(student):
    if student.status == StudentStatus.LEFT:
        return Admission(False, Refusal.NOT_ENROLLED)

    verdicts = []
    for vertical in student.organization.verticals or []:
        rule = _RULES.get(vertical)
        if rule is None:
            continue
        verdict = rule(student)
        if verdict is not None:
            verdicts.append(verdict)

    if not verdicts:
        # Nothing sells entry here, so being on the roster is enough.
        return Admission(True)

    # One yes is enough; another vertical having no plan for them isn't a no.
    for verdict in verdicts:
        if verdict.allowed:
            return verdict
    return verdicts[0]
