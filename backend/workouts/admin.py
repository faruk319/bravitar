from django.contrib import admin

from .models import Routine, RoutineExercise, SetLog, WorkoutSession


class RoutineExerciseInline(admin.TabularInline):
    model = RoutineExercise
    extra = 0


@admin.register(Routine)
class RoutineAdmin(admin.ModelAdmin):
    list_display = ["name", "academy", "student", "created_at"]
    inlines = [RoutineExerciseInline]


class SetLogInline(admin.TabularInline):
    model = SetLog
    extra = 0


@admin.register(WorkoutSession)
class WorkoutSessionAdmin(admin.ModelAdmin):
    list_display = ["__str__", "academy", "student", "started_at", "completed_at"]
    inlines = [SetLogInline]
