class StudentStatus:
    TRIAL = "trial"
    ACTIVE = "active"
    PAUSED = "paused"
    LEFT = "left"

    CHOICES = [
        (TRIAL, "Trial"),
        (ACTIVE, "Active"),
        (PAUSED, "Paused"),
        (LEFT, "Left"),
    ]
    VALUES = [value for value, _ in CHOICES]
