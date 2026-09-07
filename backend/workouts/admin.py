from django.contrib import admin

from .models import Routine, RoutineExercise, SetLog, WorkoutSession


class RoutineExerciseInline(admin.TabularInline):
    model = RoutineExercise
    extra = 0


@admin.register(Routine)
class RoutineAdmin(admin.ModelAdmin):
    list_display = ["name", "organization", "user_id", "created_at"]
    inlines = [RoutineExerciseInline]


class SetLogInline(admin.TabularInline):
    model = SetLog
    extra = 0


@admin.register(WorkoutSession)
class WorkoutSessionAdmin(admin.ModelAdmin):
    list_display = ["__str__", "organization", "user_id", "started_at", "completed_at"]
    inlines = [SetLogInline]
