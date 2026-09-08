from django.contrib import admin

from .models import Academy, APIKey, Branch, Membership


@admin.register(Academy)
class AcademyAdmin(admin.ModelAdmin):
    list_display = ["name", "slug", "plan", "domain_verified", "created_at"]
    search_fields = ["name", "slug", "custom_domain"]


@admin.register(Branch)
class BranchAdmin(admin.ModelAdmin):
    list_display = ["name", "academy", "is_primary"]


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display = ["email", "academy", "role"]


@admin.register(APIKey)
class APIKeyAdmin(admin.ModelAdmin):
    list_display = ["prefix", "academy", "is_active", "last_used_at"]
