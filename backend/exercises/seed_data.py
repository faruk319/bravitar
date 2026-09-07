"""The shared exercise library seeded into every install.

Kept as plain data rather than a fixture so it stays readable and diffable.
Each entry: (name, category, equipment, primary_muscle, secondary_muscles).
"""

from .constants import Category, Equipment, Muscle

SHARED_EXERCISES = [
    # Chest
    ("Barbell Bench Press", Category.STRENGTH, Equipment.BARBELL, Muscle.CHEST, [Muscle.TRICEPS, Muscle.SHOULDERS]),
    ("Incline Barbell Bench Press", Category.STRENGTH, Equipment.BARBELL, Muscle.CHEST, [Muscle.SHOULDERS, Muscle.TRICEPS]),
    ("Dumbbell Bench Press", Category.STRENGTH, Equipment.DUMBBELL, Muscle.CHEST, [Muscle.TRICEPS, Muscle.SHOULDERS]),
    ("Incline Dumbbell Press", Category.STRENGTH, Equipment.DUMBBELL, Muscle.CHEST, [Muscle.SHOULDERS, Muscle.TRICEPS]),
    ("Dumbbell Fly", Category.STRENGTH, Equipment.DUMBBELL, Muscle.CHEST, []),
    ("Cable Crossover", Category.STRENGTH, Equipment.CABLE, Muscle.CHEST, []),
    ("Push-Up", Category.STRENGTH, Equipment.BODYWEIGHT, Muscle.CHEST, [Muscle.TRICEPS, Muscle.ABS]),
    ("Chest Dip", Category.STRENGTH, Equipment.BODYWEIGHT, Muscle.CHEST, [Muscle.TRICEPS]),
    ("Machine Chest Press", Category.STRENGTH, Equipment.MACHINE, Muscle.CHEST, [Muscle.TRICEPS]),

    # Back
    ("Deadlift", Category.STRENGTH, Equipment.BARBELL, Muscle.LOWER_BACK, [Muscle.GLUTES, Muscle.HAMSTRINGS, Muscle.UPPER_BACK]),
    ("Barbell Row", Category.STRENGTH, Equipment.BARBELL, Muscle.UPPER_BACK, [Muscle.LATS, Muscle.BICEPS]),
    ("Pull-Up", Category.STRENGTH, Equipment.BODYWEIGHT, Muscle.LATS, [Muscle.BICEPS, Muscle.UPPER_BACK]),
    ("Chin-Up", Category.STRENGTH, Equipment.BODYWEIGHT, Muscle.LATS, [Muscle.BICEPS]),
    ("Lat Pulldown", Category.STRENGTH, Equipment.CABLE, Muscle.LATS, [Muscle.BICEPS]),
    ("Seated Cable Row", Category.STRENGTH, Equipment.CABLE, Muscle.UPPER_BACK, [Muscle.LATS, Muscle.BICEPS]),
    ("Dumbbell Row", Category.STRENGTH, Equipment.DUMBBELL, Muscle.LATS, [Muscle.UPPER_BACK, Muscle.BICEPS]),
    ("T-Bar Row", Category.STRENGTH, Equipment.BARBELL, Muscle.UPPER_BACK, [Muscle.LATS]),
    ("Face Pull", Category.STRENGTH, Equipment.CABLE, Muscle.UPPER_BACK, [Muscle.SHOULDERS]),
    ("Back Extension", Category.STRENGTH, Equipment.BODYWEIGHT, Muscle.LOWER_BACK, [Muscle.GLUTES]),

    # Legs
    ("Back Squat", Category.STRENGTH, Equipment.BARBELL, Muscle.QUADS, [Muscle.GLUTES, Muscle.LOWER_BACK]),
    ("Front Squat", Category.STRENGTH, Equipment.BARBELL, Muscle.QUADS, [Muscle.GLUTES, Muscle.ABS]),
    ("Romanian Deadlift", Category.STRENGTH, Equipment.BARBELL, Muscle.HAMSTRINGS, [Muscle.GLUTES, Muscle.LOWER_BACK]),
    ("Leg Press", Category.STRENGTH, Equipment.MACHINE, Muscle.QUADS, [Muscle.GLUTES]),
    ("Walking Lunge", Category.STRENGTH, Equipment.DUMBBELL, Muscle.QUADS, [Muscle.GLUTES, Muscle.HAMSTRINGS]),
    ("Bulgarian Split Squat", Category.STRENGTH, Equipment.DUMBBELL, Muscle.QUADS, [Muscle.GLUTES]),
    ("Leg Extension", Category.STRENGTH, Equipment.MACHINE, Muscle.QUADS, []),
    ("Lying Leg Curl", Category.STRENGTH, Equipment.MACHINE, Muscle.HAMSTRINGS, []),
    ("Hip Thrust", Category.STRENGTH, Equipment.BARBELL, Muscle.GLUTES, [Muscle.HAMSTRINGS]),
    ("Standing Calf Raise", Category.STRENGTH, Equipment.MACHINE, Muscle.CALVES, []),
    ("Seated Calf Raise", Category.STRENGTH, Equipment.MACHINE, Muscle.CALVES, []),
    ("Hip Adduction Machine", Category.STRENGTH, Equipment.MACHINE, Muscle.ADDUCTORS, []),
    ("Hip Abduction Machine", Category.STRENGTH, Equipment.MACHINE, Muscle.ABDUCTORS, []),

    # Shoulders
    ("Overhead Press", Category.STRENGTH, Equipment.BARBELL, Muscle.SHOULDERS, [Muscle.TRICEPS]),
    ("Seated Dumbbell Shoulder Press", Category.STRENGTH, Equipment.DUMBBELL, Muscle.SHOULDERS, [Muscle.TRICEPS]),
    ("Lateral Raise", Category.STRENGTH, Equipment.DUMBBELL, Muscle.SHOULDERS, []),
    ("Rear Delt Fly", Category.STRENGTH, Equipment.DUMBBELL, Muscle.SHOULDERS, [Muscle.UPPER_BACK]),
    ("Upright Row", Category.STRENGTH, Equipment.BARBELL, Muscle.SHOULDERS, [Muscle.UPPER_BACK]),
    ("Shrug", Category.STRENGTH, Equipment.DUMBBELL, Muscle.UPPER_BACK, [Muscle.NECK]),

    # Arms
    ("Barbell Curl", Category.STRENGTH, Equipment.BARBELL, Muscle.BICEPS, [Muscle.FOREARMS]),
    ("Dumbbell Curl", Category.STRENGTH, Equipment.DUMBBELL, Muscle.BICEPS, [Muscle.FOREARMS]),
    ("Hammer Curl", Category.STRENGTH, Equipment.DUMBBELL, Muscle.BICEPS, [Muscle.FOREARMS]),
    ("Preacher Curl", Category.STRENGTH, Equipment.BARBELL, Muscle.BICEPS, []),
    ("Close-Grip Bench Press", Category.STRENGTH, Equipment.BARBELL, Muscle.TRICEPS, [Muscle.CHEST]),
    ("Triceps Pushdown", Category.STRENGTH, Equipment.CABLE, Muscle.TRICEPS, []),
    ("Overhead Triceps Extension", Category.STRENGTH, Equipment.DUMBBELL, Muscle.TRICEPS, []),
    ("Triceps Dip", Category.STRENGTH, Equipment.BODYWEIGHT, Muscle.TRICEPS, [Muscle.CHEST]),
    ("Wrist Curl", Category.STRENGTH, Equipment.DUMBBELL, Muscle.FOREARMS, []),

    # Core
    ("Plank", Category.STRENGTH, Equipment.BODYWEIGHT, Muscle.ABS, [Muscle.OBLIQUES]),
    ("Hanging Leg Raise", Category.STRENGTH, Equipment.BODYWEIGHT, Muscle.ABS, [Muscle.OBLIQUES]),
    ("Cable Crunch", Category.STRENGTH, Equipment.CABLE, Muscle.ABS, []),
    ("Russian Twist", Category.STRENGTH, Equipment.BODYWEIGHT, Muscle.OBLIQUES, [Muscle.ABS]),
    ("Ab Wheel Rollout", Category.STRENGTH, Equipment.OTHER, Muscle.ABS, [Muscle.LOWER_BACK]),
    ("Side Plank", Category.STRENGTH, Equipment.BODYWEIGHT, Muscle.OBLIQUES, [Muscle.ABS]),

    # Full body / olympic
    ("Power Clean", Category.STRENGTH, Equipment.BARBELL, Muscle.FULL_BODY, [Muscle.QUADS, Muscle.UPPER_BACK]),
    ("Kettlebell Swing", Category.STRENGTH, Equipment.KETTLEBELL, Muscle.GLUTES, [Muscle.HAMSTRINGS, Muscle.LOWER_BACK]),
    ("Burpee", Category.STRENGTH, Equipment.BODYWEIGHT, Muscle.FULL_BODY, [Muscle.CHEST, Muscle.QUADS]),
    ("Farmer's Walk", Category.STRENGTH, Equipment.DUMBBELL, Muscle.FOREARMS, [Muscle.FULL_BODY]),

    # Cardio
    ("Treadmill Run", Category.CARDIO, Equipment.MACHINE, Muscle.FULL_BODY, []),
    ("Stationary Bike", Category.CARDIO, Equipment.MACHINE, Muscle.QUADS, [Muscle.CALVES]),
    ("Rowing Machine", Category.CARDIO, Equipment.MACHINE, Muscle.FULL_BODY, [Muscle.UPPER_BACK]),
    ("Elliptical", Category.CARDIO, Equipment.MACHINE, Muscle.FULL_BODY, []),
    ("Jump Rope", Category.CARDIO, Equipment.OTHER, Muscle.CALVES, [Muscle.FULL_BODY]),
    ("Stair Climber", Category.CARDIO, Equipment.MACHINE, Muscle.GLUTES, [Muscle.QUADS, Muscle.CALVES]),

    # Mobility
    ("Hip Flexor Stretch", Category.MOBILITY, Equipment.BODYWEIGHT, Muscle.QUADS, [Muscle.GLUTES]),
    ("Hamstring Stretch", Category.MOBILITY, Equipment.BODYWEIGHT, Muscle.HAMSTRINGS, []),
    ("Thoracic Rotation", Category.MOBILITY, Equipment.BODYWEIGHT, Muscle.UPPER_BACK, [Muscle.OBLIQUES]),
    ("Shoulder Dislocate", Category.MOBILITY, Equipment.BAND, Muscle.SHOULDERS, []),
]
