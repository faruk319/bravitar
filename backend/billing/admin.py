from django.contrib import admin

from .models import FeePlan, Invoice, Payment


class PaymentInline(admin.TabularInline):
    model = Payment
    extra = 0


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = ["student", "amount", "due_on", "status"]
    inlines = [PaymentInline]


@admin.register(FeePlan)
class FeePlanAdmin(admin.ModelAdmin):
    list_display = ["name", "academy", "amount", "cycle", "is_active"]
