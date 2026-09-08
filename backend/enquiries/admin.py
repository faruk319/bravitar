from django.contrib import admin

from .models import Enquiry


@admin.register(Enquiry)
class EnquiryAdmin(admin.ModelAdmin):
    list_display = ["name", "academy", "status", "source", "created_at"]
    list_filter = ["status", "source"]
    search_fields = ["name", "phone", "email"]
