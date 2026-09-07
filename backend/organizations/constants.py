class Vertical:
    GYM = "gym"
    SWIMMING = "swimming"
    DANCE = "dance"
    KARATE = "karate"
    FOOTBALL = "football"

    CHOICES = [
        (GYM, "Gym / Fitness"),
        (SWIMMING, "Swimming Academy"),
        (DANCE, "Dance Academy"),
        (KARATE, "Karate / Martial Arts"),
        (FOOTBALL, "Football Academy"),
    ]
    VALUES = [value for value, _ in CHOICES]


class Plan:
    FREE = "free"
    PRO = "pro"
    ENTERPRISE = "enterprise"

    CHOICES = [
        (FREE, "Free"),
        (PRO, "Pro"),
        (ENTERPRISE, "Enterprise"),
    ]


class Role:
    """Who can sign in to an academy, and what they run.

    OWNER > MANAGER > STAFF, each including everything below it.

    MEMBER is deliberately not sign-in-able yet. Members are tracked as
    Student records — a Student is an enrolment, a Membership is a login, and
    most students (children especially) never need one. The role is kept
    defined so existing rows stay valid and member sign-in can be switched on
    later without losing who was already linked.
    """

    OWNER = "owner"
    MANAGER = "manager"
    STAFF = "staff"
    MEMBER = "member"

    CHOICES = [
        (OWNER, "Owner"),
        (MANAGER, "Manager"),
        (STAFF, "Staff / Trainer"),
        (MEMBER, "Member"),
    ]

    # Roles an owner can actually hand out today.
    ASSIGNABLE = [OWNER, MANAGER, STAFF]

    # Roles that may sign in and use the API at all.
    CAN_SIGN_IN = [OWNER, MANAGER, STAFF]

    # Everything an owner can do; managers run the academy including its money.
    MANAGES = [OWNER, MANAGER]
    # Day-to-day running: students, batches, registers, training content.
    RUNS_SESSIONS = [OWNER, MANAGER, STAFF]
