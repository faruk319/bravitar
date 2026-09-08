class Vertical:
    """What an academy does. These compose: a gym almost always wants
    FITNESS alongside GYM, and a swimming academy might want it too for the
    dry-land training its swimmers do.

    GYM is the business — memberships, check-ins, classes, trainers.
    FITNESS is the training itself — exercises, workouts, nutrition, body
    measurements. Keeping them apart is what lets one be taken without the
    other.
    """

    GYM = "gym"
    FITNESS = "fitness"
    SWIMMING = "swimming"
    DANCE = "dance"
    KARATE = "karate"
    FOOTBALL = "football"

    CHOICES = [
        (GYM, "Gym Management"),
        (FITNESS, "Fitness Tracking"),
        (SWIMMING, "Swimming Academy"),
        (DANCE, "Dance Academy"),
        (KARATE, "Karate / Martial Arts"),
        (FOOTBALL, "Football Academy"),
    ]
    VALUES = [value for value, _ in CHOICES]

    # Verticals that actually have a plugin behind them. Dance and football
    # are named here because the platform knows about them, but offering an
    # academy a module with nothing behind it is worse than not listing it —
    # so they can't be selected until their plugin ships.
    IMPLEMENTED = [GYM, FITNESS, SWIMMING, KARATE]


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

    Only OWNER and MANAGER can sign in today. STAFF and MEMBER are fully
    wired but switched off while the product is built around the two roles
    that run the academy; turning either on is a line in `ASSIGNABLE` and
    `CAN_SIGN_IN`. Members are tracked as Student records regardless — a
    Student is an enrolment, a Membership is a login, and most students
    (children especially) never need one.
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

    # Roles an owner can hand out today. Staff and member are defined and
    # their permissions are wired, but neither is switched on yet — the
    # product is being built around owners and managers first. Existing rows
    # keep their role so nobody has to be re-invited when they are enabled.
    ASSIGNABLE = [OWNER, MANAGER]

    # Roles that may sign in and use the API at all.
    CAN_SIGN_IN = [OWNER, MANAGER]

    # Everything an owner can do; managers run the academy including its money.
    MANAGES = [OWNER, MANAGER]
    # Day-to-day running: students, batches, registers, training content.
    RUNS_SESSIONS = [OWNER, MANAGER, STAFF]

    # A role held at one branch can differ from one held at another, so roles
    # have to be comparable rather than just listed.
    RANK = {OWNER: 3, MANAGER: 2, STAFF: 1, MEMBER: 0}

    # What an owner assigns per branch. Owner is organization-wide by
    # definition — it isn't something you are at one location.
    PER_BRANCH = [MANAGER, STAFF]

    @classmethod
    def at_least(cls, held, needed):
        return cls.RANK.get(held, 0) >= cls.RANK.get(needed, 0)
