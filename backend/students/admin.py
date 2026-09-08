from django.contrib import admin

from .models import Student


@admin.register(Student)
class StudentAdmin(admin.ModelAdmin):
    list_display = ["full_name", "academy", "branch", "status", "joined_on"]
    list_filter = ["status"]
    search_fields = ["full_name", "phone", "email"]
