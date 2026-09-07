class ProgressionRule:
    """How the next session's targets are derived from the last one."""

    NONE = "none"
    LINEAR = "linear"
    DOUBLE = "double_progression"
    GREYSKULL = "greyskull"

    CHOICES = [
        (NONE, "None — repeat the same targets"),
        (LINEAR, "Linear — add weight when every set hits the target"),
        (DOUBLE, "Double progression — add reps to the top of the range, then weight"),
        (GREYSKULL, "Greyskull LP — last set is AMRAP, double the jump on a big set"),
    ]
    VALUES = [value for value, _ in CHOICES]
