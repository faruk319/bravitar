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
    OWNER = "owner"
    STAFF = "staff"
    MEMBER = "member"

    CHOICES = [
        (OWNER, "Owner"),
        (STAFF, "Staff / Trainer"),
        (MEMBER, "Member"),
    ]
