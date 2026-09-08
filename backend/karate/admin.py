from django.contrib import admin

from .models import Belt, Bout, Grading, GradingResult


class GradingResultInline(admin.TabularInline):
    model = GradingResult
    extra = 0


@admin.register(Grading)
class GradingAdmin(admin.ModelAdmin):
    list_display = ["belt", "held_on", "academy", "examiner"]
    inlines = [GradingResultInline]


@admin.register(Belt)
class BeltAdmin(admin.ModelAdmin):
    list_display = ["name", "academy", "position"]


@admin.register(Bout)
class BoutAdmin(admin.ModelAdmin):
    list_display = ["student", "fought_on", "result", "points_for", "points_against"]
    list_filter = ["result"]
