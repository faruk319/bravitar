class StudentStatus:
    ACTIVE = "active"
    TRIAL = "trial"
    LEFT = "left"

    CHOICES = [
        (ACTIVE, "Active"),
        (TRIAL, "Trial"),
        (LEFT, "Left"),
    ]
    VALUES = [value for value, _ in CHOICES]


class DocumentKind:
    """Which proof of identity a scan is.

    Aadhaar is here because Indian gyms ask for it, but see
    `MemberDocument.number_last4` — the full number is deliberately not
    storable.
    """

    AADHAAR = "aadhaar"
    PAN = "pan"
    PASSPORT = "passport"
    DRIVING_LICENCE = "driving_licence"
    VOTER_ID = "voter_id"
    STUDENT_ID = "student_id"
    OTHER = "other"

    CHOICES = [
        (AADHAAR, "Aadhaar"),
        (PAN, "PAN card"),
        (PASSPORT, "Passport"),
        (DRIVING_LICENCE, "Driving licence"),
        (VOTER_ID, "Voter ID"),
        (STUDENT_ID, "Student ID"),
        (OTHER, "Other"),
    ]
    VALUES = [value for value, _ in CHOICES]


class Upload:
    """Limits on what onboarding will accept.

    A gym's front desk uploads straight off a phone, so the ceilings are
    generous — but unbounded uploads are how a tenant fills the disk, and an
    unchecked content type is how an "ID proof" turns out to be a script.
    """

    MAX_PHOTO_BYTES = 5 * 1024 * 1024
    MAX_DOCUMENT_BYTES = 10 * 1024 * 1024

    PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"]
    DOCUMENT_TYPES = PHOTO_TYPES + ["application/pdf"]

    EXTENSIONS = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "application/pdf": "pdf",
    }
