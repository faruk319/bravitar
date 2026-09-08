"""A standard learn-to-swim ladder, seeded per academy and editable
afterwards. Levels are ordered; a level is reached only when every skill in
it is signed off."""

SWIM_LADDER = [
    ("Level 1 — Water Confidence", "Getting comfortable and safe in the water.", [
        "Enter and exit the pool safely",
        "Submerge face and blow bubbles",
        "Float on front with support",
        "Float on back with support",
    ]),
    ("Level 2 — Independence", "Moving without support.", [
        "Float on back unaided for 10 seconds",
        "Glide on front for 3 metres",
        "Kick 5 metres on front with a board",
        "Retrieve an object from waist-deep water",
    ]),
    ("Level 3 — Front Crawl", "First full stroke.", [
        "Front crawl arms with breathing to the side",
        "Swim 15 metres front crawl",
        "Tread water for 30 seconds",
        "Push and glide into a stroke",
    ]),
    ("Level 4 — Backstroke & Breaststroke", "Widening the stroke range.", [
        "Swim 15 metres backstroke",
        "Breaststroke kick over 10 metres",
        "Swim 25 metres front crawl",
        "Surface dive to the pool floor",
    ]),
    ("Level 5 — Competent Swimmer", "Distance, turns and water safety.", [
        "Swim 50 metres front crawl",
        "Swim 50 metres backstroke",
        "Perform a tumble turn",
        "Tread water for 2 minutes",
        "Swim 100 metres continuously",
    ]),
]
