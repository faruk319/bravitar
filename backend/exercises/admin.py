from django.contrib import admin

from .models import Exercise


@admin.register(Exercise)
class ExerciseAdmin(admin.ModelAdmin):
    list_display = ["name", "organization", "category", "equipment", "primary_muscle"]
    list_filter = ["category", "equipment", "primary_muscle"]
    search_fields = ["name"]
