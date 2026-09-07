"""Shared food library.

Values are **approximate reference figures per 100 g** of the food as commonly
eaten, drawn from standard food-composition tables. They are good enough for
tracking trends, but they are not a substitute for the label on a packet —
brands vary, and cooking changes weight. Anyone tracking closely should add a
custom food with the numbers from their own packaging.

Each entry: (name, kcal, protein_g, carbs_g, fat_g, fiber_g|None,
             serving_size_g|None, serving_label)
"""

SHARED_FOODS = [
    # Poultry, meat & fish
    ("Chicken Breast, skinless", 165, 31.0, 0.0, 3.6, None, None, ""),
    ("Chicken Thigh, skinless", 209, 26.0, 0.0, 10.9, None, None, ""),
    ("Beef Mince, 80/20", 254, 17.2, 0.0, 20.0, None, None, ""),
    ("Pork Chop", 231, 25.7, 0.0, 13.9, None, None, ""),
    ("Mutton, cooked", 258, 25.6, 0.0, 16.5, None, None, ""),
    ("Salmon", 208, 20.4, 0.0, 13.4, None, None, ""),
    ("Tuna, canned in water", 116, 25.5, 0.0, 0.8, None, None, ""),
    ("Prawns", 99, 24.0, 0.2, 0.3, None, None, ""),
    ("Egg, whole", 143, 12.6, 0.7, 9.5, None, 50, "1 large egg"),
    ("Egg White", 52, 10.9, 0.7, 0.2, None, 33, "1 large white"),

    # Dairy
    ("Whole Milk", 61, 3.2, 4.8, 3.3, None, 240, "1 cup"),
    ("Skimmed Milk", 34, 3.4, 5.0, 0.1, None, 240, "1 cup"),
    ("Greek Yogurt, plain nonfat", 59, 10.3, 3.6, 0.4, None, 170, "1 pot"),
    ("Curd / Dahi", 61, 3.5, 4.7, 3.3, None, None, ""),
    ("Paneer", 296, 18.3, 3.6, 22.8, None, None, ""),
    ("Cheddar Cheese", 403, 24.9, 1.3, 33.1, None, 28, "1 slice"),
    ("Cottage Cheese", 98, 11.1, 3.4, 4.3, None, None, ""),
    ("Butter", 717, 0.9, 0.1, 81.1, None, 14, "1 tbsp"),

    # Grains & starches
    ("White Rice, cooked", 130, 2.7, 28.0, 0.3, 0.4, None, ""),
    ("Brown Rice, cooked", 112, 2.6, 24.0, 0.9, 1.8, None, ""),
    ("Basmati Rice, cooked", 121, 3.5, 25.2, 0.4, 0.7, None, ""),
    ("Roti / Chapati", 297, 11.0, 46.0, 7.5, 4.9, 40, "1 roti"),
    ("Whole Wheat Bread", 247, 13.0, 41.0, 3.4, 7.0, 32, "1 slice"),
    ("White Bread", 265, 9.0, 49.0, 3.2, 2.7, 30, "1 slice"),
    ("Pasta, cooked", 131, 5.0, 25.0, 1.1, 1.8, None, ""),
    ("Oats, dry", 389, 16.9, 66.3, 6.9, 10.6, 40, "1/2 cup"),
    ("Quinoa, cooked", 120, 4.4, 21.3, 1.9, 2.8, None, ""),
    ("Poha, dry", 356, 6.6, 77.3, 1.2, 2.4, None, ""),
    ("Potato, boiled", 87, 2.0, 20.1, 0.1, 1.8, None, ""),
    ("Sweet Potato, boiled", 86, 1.6, 20.1, 0.1, 3.0, None, ""),

    # Pulses & legumes
    ("Toor Dal, cooked", 121, 7.0, 21.0, 0.4, 4.6, None, ""),
    ("Moong Dal, cooked", 105, 7.0, 19.0, 0.4, 7.6, None, ""),
    ("Rajma, cooked", 127, 8.7, 22.8, 0.5, 6.4, None, ""),
    ("Chana / Chickpeas, cooked", 164, 8.9, 27.4, 2.6, 7.6, None, ""),
    ("Lentils, cooked", 116, 9.0, 20.1, 0.4, 7.9, None, ""),
    ("Black Beans, cooked", 132, 8.9, 23.7, 0.5, 8.7, None, ""),
    ("Tofu, firm", 76, 8.1, 1.9, 4.8, 0.3, None, ""),
    ("Soya Chunks, dry", 345, 52.0, 33.0, 0.5, 13.0, None, ""),

    # Vegetables
    ("Broccoli", 34, 2.8, 6.6, 0.4, 2.6, None, ""),
    ("Spinach / Palak", 23, 2.9, 3.6, 0.4, 2.2, None, ""),
    ("Carrot", 41, 0.9, 9.6, 0.2, 2.8, None, ""),
    ("Tomato", 18, 0.9, 3.9, 0.2, 1.2, None, ""),
    ("Onion", 40, 1.1, 9.3, 0.1, 1.7, None, ""),
    ("Cucumber", 15, 0.7, 3.6, 0.1, 0.5, None, ""),
    ("Cauliflower / Gobi", 25, 1.9, 5.0, 0.3, 2.0, None, ""),
    ("Okra / Bhindi", 33, 1.9, 7.5, 0.2, 3.2, None, ""),

    # Fruit
    ("Banana", 89, 1.1, 22.8, 0.3, 2.6, 118, "1 medium"),
    ("Apple", 52, 0.3, 13.8, 0.2, 2.4, 182, "1 medium"),
    ("Orange", 47, 0.9, 11.8, 0.1, 2.4, 131, "1 medium"),
    ("Mango", 60, 0.8, 15.0, 0.4, 1.6, None, ""),
    ("Grapes", 69, 0.7, 18.1, 0.2, 0.9, None, ""),
    ("Papaya", 43, 0.5, 10.8, 0.3, 1.7, None, ""),
    ("Avocado", 160, 2.0, 8.5, 14.7, 6.7, 150, "1 medium"),

    # Nuts, oils & extras
    ("Almonds", 579, 21.2, 21.6, 49.9, 12.5, 28, "1 handful"),
    ("Walnuts", 654, 15.2, 13.7, 65.2, 6.7, 28, "1 handful"),
    ("Peanut Butter", 588, 25.1, 20.0, 50.4, 6.0, 16, "1 tbsp"),
    ("Olive Oil", 884, 0.0, 0.0, 100.0, 0.0, 14, "1 tbsp"),
    ("Ghee", 900, 0.0, 0.0, 100.0, 0.0, 14, "1 tbsp"),
    ("Whey Protein Powder", 400, 80.0, 8.0, 6.0, None, 30, "1 scoop"),
    ("Honey", 304, 0.3, 82.4, 0.0, 0.2, 21, "1 tbsp"),
    ("Sugar", 387, 0.0, 100.0, 0.0, 0.0, 4, "1 tsp"),
    ("Dark Chocolate, 70%", 598, 7.8, 45.9, 42.6, 10.9, None, ""),
]
