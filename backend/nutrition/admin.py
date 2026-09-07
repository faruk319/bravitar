from django.contrib import admin

from .models import Food, FoodLogEntry, NutritionPlan


@admin.register(Food)
class FoodAdmin(admin.ModelAdmin):
    list_display = ["name", "organization", "energy_kcal", "protein_g", "carbs_g", "fat_g"]
    search_fields = ["name", "brand"]


@admin.register(NutritionPlan)
class NutritionPlanAdmin(admin.ModelAdmin):
    list_display = ["name", "organization", "user_id", "target_kcal"]


@admin.register(FoodLogEntry)
class FoodLogEntryAdmin(admin.ModelAdmin):
    list_display = ["food", "amount_g", "meal", "consumed_on", "user_id"]
    list_filter = ["meal", "consumed_on"]
