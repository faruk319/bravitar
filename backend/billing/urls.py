from django.urls import path

from . import views

urlpatterns = [
    path("plans/", views.FeePlanListCreateView.as_view(), name="fee-plan-list-create"),
    path("plans/<int:pk>/", views.FeePlanDetailView.as_view(), name="fee-plan-detail"),
    path("invoices/", views.InvoiceListCreateView.as_view(), name="invoice-list-create"),
    path("invoices/<int:pk>/", views.InvoiceDetailView.as_view(), name="invoice-detail"),
    path("payments/", views.PaymentListCreateView.as_view(), name="payment-list-create"),
    path("summary/", views.billing_summary, name="billing-summary"),
]
