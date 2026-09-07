class Meal:
    BREAKFAST = "breakfast"
    LUNCH = "lunch"
    DINNER = "dinner"
    SNACK = "snack"

    CHOICES = [
        (BREAKFAST, "Breakfast"),
        (LUNCH, "Lunch"),
        (DINNER, "Dinner"),
        (SNACK, "Snack"),
    ]
    VALUES = [value for value, _ in CHOICES]
    # Display order, not alphabetical — a day reads breakfast to dinner.
    ORDER = {BREAKFAST: 0, LUNCH: 1, DINNER: 2, SNACK: 3}


# Macronutrient energy, kcal per gram. Used to derive targets from a calorie
# goal and to sanity-check food entries.
KCAL_PER_GRAM = {"protein": 4, "carbs": 4, "fat": 9}
