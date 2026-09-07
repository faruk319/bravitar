from django.contrib import admin

from .models import Batch, Enrolment


class EnrolmentInline(admin.TabularInline):
    model = Enrolment
    extra = 0


@admin.register(Batch)
class BatchAdmin(admin.ModelAdmin):
    list_display = ["name", "organization", "branch", "coach_name", "is_active"]
    inlines = [EnrolmentInline]
