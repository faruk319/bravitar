class Unit:
    KG = "kg"
    LB = "lb"
    CM = "cm"
    IN = "in"
    PERCENT = "percent"

    CHOICES = [
        (KG, "kg"),
        (LB, "lb"),
        (CM, "cm"),
        (IN, "in"),
        (PERCENT, "%"),
    ]
    VALUES = [value for value, _ in CHOICES]

    MASS = [KG, LB]
    LENGTH = [CM, IN]
    RATIO = [PERCENT]


class Metric:
    """What can be tracked. Each metric declares the units it accepts, so a
    waist measurement can't be recorded in kilograms."""

    WEIGHT = "weight"
    BODY_FAT = "body_fat"
    NECK = "neck"
    SHOULDERS = "shoulders"
    CHEST = "chest"
    WAIST = "waist"
    HIPS = "hips"
    BICEP_LEFT = "bicep_left"
    BICEP_RIGHT = "bicep_right"
    FOREARM_LEFT = "forearm_left"
    FOREARM_RIGHT = "forearm_right"
    THIGH_LEFT = "thigh_left"
    THIGH_RIGHT = "thigh_right"
    CALF_LEFT = "calf_left"
    CALF_RIGHT = "calf_right"

    CHOICES = [
        (WEIGHT, "Body Weight"),
        (BODY_FAT, "Body Fat"),
        (NECK, "Neck"),
        (SHOULDERS, "Shoulders"),
        (CHEST, "Chest"),
        (WAIST, "Waist"),
        (HIPS, "Hips"),
        (BICEP_LEFT, "Bicep (left)"),
        (BICEP_RIGHT, "Bicep (right)"),
        (FOREARM_LEFT, "Forearm (left)"),
        (FOREARM_RIGHT, "Forearm (right)"),
        (THIGH_LEFT, "Thigh (left)"),
        (THIGH_RIGHT, "Thigh (right)"),
        (CALF_LEFT, "Calf (left)"),
        (CALF_RIGHT, "Calf (right)"),
    ]
    VALUES = [value for value, _ in CHOICES]

    ALLOWED_UNITS = {
        WEIGHT: Unit.MASS,
        BODY_FAT: Unit.RATIO,
    }
    DEFAULT_UNIT = {WEIGHT: Unit.KG, BODY_FAT: Unit.PERCENT}

    @classmethod
    def allowed_units(cls, metric):
        return cls.ALLOWED_UNITS.get(metric, Unit.LENGTH)

    @classmethod
    def default_unit(cls, metric):
        return cls.DEFAULT_UNIT.get(metric, Unit.CM)


class Pose:
    FRONT = "front"
    SIDE = "side"
    BACK = "back"

    CHOICES = [(FRONT, "Front"), (SIDE, "Side"), (BACK, "Back")]
    VALUES = [value for value, _ in CHOICES]
