from django.contrib import admin

from .models import MemberSubscription, MembershipTier


@admin.register(MembershipTier)
class MembershipTierAdmin(admin.ModelAdmin):
    list_display = ["name", "academy", "period", "duration_days", "price", "is_active"]


@admin.register(MemberSubscription)
class MemberSubscriptionAdmin(admin.ModelAdmin):
    list_display = ["student", "tier", "started_on", "expires_on", "status"]
    list_filter = ["tier"]
