from decimal import Decimal

from django.utils import timezone
from rest_framework import generics
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from tenants.context import get_current_organization
from tenants.mixins import OrganizationScopedMixin
from tenants.permissions import IsOrganizationManager, IsOrganizationStaff

from .constants import InvoiceStatus
from .models import FeePlan, Invoice, Payment
from .serializers import FeePlanSerializer, InvoiceSerializer, PaymentSerializer


class BillingScopedMixin(OrganizationScopedMixin):
    """Anyone running the academy can read the books; changing them —
    raising an invoice, recording a payment — is a manager's job."""

    def get_permissions(self):
        if self.request.method not in ("GET", "HEAD", "OPTIONS"):
            return [IsOrganizationManager()]
        return super().get_permissions()


class FeePlanListCreateView(BillingScopedMixin, generics.ListCreateAPIView):
    serializer_class = FeePlanSerializer

    def get_queryset(self):
        return self.scoped(FeePlan)


class FeePlanDetailView(BillingScopedMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = FeePlanSerializer

    def get_queryset(self):
        return self.scoped(FeePlan)


class InvoiceListCreateView(BillingScopedMixin, generics.ListCreateAPIView):
    serializer_class = InvoiceSerializer

    def get_queryset(self):
        queryset = self.scoped(Invoice).select_related("student").prefetch_related("payments")
        params = self.request.query_params
        if student := params.get("student"):
            queryset = queryset.filter(student_id=student)
        if params.get("status") == InvoiceStatus.OVERDUE:
            queryset = queryset.filter(due_on__lt=timezone.localdate(), is_cancelled=False)
        return queryset


class InvoiceDetailView(BillingScopedMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = InvoiceSerializer

    def get_queryset(self):
        return self.scoped(Invoice).select_related("student").prefetch_related("payments")


class PaymentListCreateView(BillingScopedMixin, generics.ListCreateAPIView):
    serializer_class = PaymentSerializer

    def get_queryset(self):
        queryset = Payment.objects.filter(invoice__academy=self.academy)
        if invoice := self.request.query_params.get("invoice"):
            queryset = queryset.filter(invoice_id=invoice)
        return queryset

    def perform_create(self, serializer):
        # Payment has no academy column — it inherits scope from the
        # invoice, which the serializer validated.
        serializer.save(recorded_by=self.request.user.id)


@api_view(["GET"])
@permission_classes([IsOrganizationStaff])
def billing_summary(request):
    """What's been billed, collected and is still outstanding.

    Readable by anyone running the academy — it is an aggregate of invoices
    they can already list. Changing the books stays with managers.
    """
    academy = get_current_organization(request)
    invoices = (
        Invoice.objects.filter(academy=academy, is_cancelled=False)
        .select_related("student")
        .prefetch_related("payments")
    )

    zero = Decimal("0.00")
    billed = collected = outstanding = overdue_amount = zero
    counts = {status: 0 for status in
              (InvoiceStatus.UNPAID, InvoiceStatus.PARTIAL, InvoiceStatus.PAID, InvoiceStatus.OVERDUE)}

    for invoice in invoices:
        billed += invoice.amount
        collected += invoice.amount_paid
        outstanding += invoice.balance
        counts[invoice.status] = counts.get(invoice.status, 0) + 1
        if invoice.status == InvoiceStatus.OVERDUE:
            overdue_amount += invoice.balance

    return Response(
        {
            "billed": billed,
            "collected": collected,
            "outstanding": outstanding,
            "overdue_amount": overdue_amount,
            "invoice_count": invoices.count(),
            "counts": counts,
        }
    )
