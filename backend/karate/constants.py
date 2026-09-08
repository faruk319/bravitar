class GradingResultChoice:
    PASS = "pass"
    FAIL = "fail"
    ABSENT = "absent"

    CHOICES = [(PASS, "Pass"), (FAIL, "Fail"), (ABSENT, "Absent")]
    VALUES = [value for value, _ in CHOICES]


class BoutResult:
    WIN = "win"
    LOSS = "loss"
    DRAW = "draw"

    CHOICES = [(WIN, "Win"), (LOSS, "Loss"), (DRAW, "Draw")]
    VALUES = [value for value, _ in CHOICES]


# A standard kyu ladder, seeded per academy and editable afterwards.
DEFAULT_BELTS = [
    ("White", "#f5f5f5"),
    ("Yellow", "#f5d020"),
    ("Orange", "#f08c28"),
    ("Green", "#3aa655"),
    ("Blue", "#2f6fd0"),
    ("Purple", "#7d4bb5"),
    ("Brown", "#7a4a24"),
    ("Black", "#1a1a1a"),
]
