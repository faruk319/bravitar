class EnquiryStatus:
    NEW = "new"
    CONTACTED = "contacted"
    TRIAL_SCHEDULED = "trial_scheduled"
    TRIAL_DONE = "trial_done"
    CONVERTED = "converted"
    LOST = "lost"

    CHOICES = [
        (NEW, "New"),
        (CONTACTED, "Contacted"),
        (TRIAL_SCHEDULED, "Trial scheduled"),
        (TRIAL_DONE, "Trial done"),
        (CONVERTED, "Converted"),
        (LOST, "Lost"),
    ]
    VALUES = [value for value, _ in CHOICES]
    # The pipeline in order, for funnel display. CONVERTED and LOST are ends.
    PIPELINE = [NEW, CONTACTED, TRIAL_SCHEDULED, TRIAL_DONE]
    OPEN = PIPELINE


class EnquirySource:
    WALK_IN = "walk_in"
    PHONE = "phone"
    WEBSITE = "website"
    REFERRAL = "referral"
    SOCIAL = "social"
    OTHER = "other"

    CHOICES = [
        (WALK_IN, "Walk-in"),
        (PHONE, "Phone"),
        (WEBSITE, "Website"),
        (REFERRAL, "Referral"),
        (SOCIAL, "Social media"),
        (OTHER, "Other"),
    ]
    VALUES = [value for value, _ in CHOICES]
