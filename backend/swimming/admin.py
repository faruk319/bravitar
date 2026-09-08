from django.contrib import admin

from .models import LaneBooking, Pool, SkillAssessment, SwimLevel, SwimSkill


class SwimSkillInline(admin.TabularInline):
    model = SwimSkill
    extra = 0


@admin.register(SwimLevel)
class SwimLevelAdmin(admin.ModelAdmin):
    list_display = ["name", "academy", "position"]
    inlines = [SwimSkillInline]


@admin.register(Pool)
class PoolAdmin(admin.ModelAdmin):
    list_display = ["name", "academy", "branch", "lane_count"]


@admin.register(LaneBooking)
class LaneBookingAdmin(admin.ModelAdmin):
    list_display = ["pool", "lane_number", "day_of_week", "start_time", "end_time", "batch"]


@admin.register(SkillAssessment)
class SkillAssessmentAdmin(admin.ModelAdmin):
    list_display = ["student", "skill", "achieved_on"]
