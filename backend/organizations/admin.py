from django.contrib import admin

from .models import APIKey, Branch, Membership, Organization


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ["name", "slug", "plan", "domain_verified", "created_at"]
    search_fields = ["name", "slug", "custom_domain"]


@admin.register(Branch)
class BranchAdmin(admin.ModelAdmin):
    list_display = ["name", "organization", "is_primary"]


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display = ["email", "organization", "role"]


@admin.register(APIKey)
class APIKeyAdmin(admin.ModelAdmin):
    list_display = ["prefix", "organization", "is_active", "last_used_at"]
