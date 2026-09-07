class Muscle:
    """Muscle vocabulary, kept as a fixed list rather than a table — the
    Phase 3 muscle map needs a known set to draw against."""

    CHEST = "chest"
    UPPER_BACK = "upper_back"
    LATS = "lats"
    LOWER_BACK = "lower_back"
    SHOULDERS = "shoulders"
    BICEPS = "biceps"
    TRICEPS = "triceps"
    FOREARMS = "forearms"
    ABS = "abs"
    OBLIQUES = "obliques"
    GLUTES = "glutes"
    QUADS = "quads"
    HAMSTRINGS = "hamstrings"
    CALVES = "calves"
    ADDUCTORS = "adductors"
    ABDUCTORS = "abductors"
    NECK = "neck"
    FULL_BODY = "full_body"

    CHOICES = [
        (CHEST, "Chest"),
        (UPPER_BACK, "Upper Back"),
        (LATS, "Lats"),
        (LOWER_BACK, "Lower Back"),
        (SHOULDERS, "Shoulders"),
        (BICEPS, "Biceps"),
        (TRICEPS, "Triceps"),
        (FOREARMS, "Forearms"),
        (ABS, "Abs"),
        (OBLIQUES, "Obliques"),
        (GLUTES, "Glutes"),
        (QUADS, "Quads"),
        (HAMSTRINGS, "Hamstrings"),
        (CALVES, "Calves"),
        (ADDUCTORS, "Adductors"),
        (ABDUCTORS, "Abductors"),
        (NECK, "Neck"),
        (FULL_BODY, "Full Body"),
    ]
    VALUES = [value for value, _ in CHOICES]


class Equipment:
    BARBELL = "barbell"
    DUMBBELL = "dumbbell"
    MACHINE = "machine"
    CABLE = "cable"
    BODYWEIGHT = "bodyweight"
    KETTLEBELL = "kettlebell"
    BAND = "band"
    OTHER = "other"

    CHOICES = [
        (BARBELL, "Barbell"),
        (DUMBBELL, "Dumbbell"),
        (MACHINE, "Machine"),
        (CABLE, "Cable"),
        (BODYWEIGHT, "Bodyweight"),
        (KETTLEBELL, "Kettlebell"),
        (BAND, "Resistance Band"),
        (OTHER, "Other"),
    ]
    VALUES = [value for value, _ in CHOICES]


class Category:
    STRENGTH = "strength"
    CARDIO = "cardio"
    MOBILITY = "mobility"

    CHOICES = [
        (STRENGTH, "Strength"),
        (CARDIO, "Cardio"),
        (MOBILITY, "Mobility"),
    ]
    VALUES = [value for value, _ in CHOICES]
