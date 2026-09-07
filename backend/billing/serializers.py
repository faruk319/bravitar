from rest_framework import serializers

from students.models import Student

from .models import FeePlan, Invoice, Payment


class FeePlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = FeePlan
        fields = ["id", "name", "amount", "cycle", "is_active"]
        read_only_fields = ["id"]


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ["id", "invoice", "amount", "paid_on", "method", "reference", "recorded_by"]
        read_only_fields = ["id", "recorded_by"]

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Payment must be greater than zero.")
        return value

    def validate(self, attrs):
        invoice = attrs.get("invoice") or getattr(self.instance, "invoice", None)
        if invoice and invoice.organization_id != self.context["organization"].id:
            raise serializers.ValidationError({"invoice": "That invoice belongs to another organization."})
        if invoice and invoice.is_cancelled:
            raise serializers.ValidationError({"invoice": "This invoice was cancelled."})

        amount = attrs.get("amount")
        if invoice and amount is not None:
            already = invoice.amount_paid
            if self.instance:
                already -= self.instance.amount
            if already + amount > invoice.amount:
                raise serializers.ValidationError(
                    {"amount": f"That would overpay the invoice — {invoice.amount - already} outstanding."}
                )
        return attrs


class InvoiceSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    payments = PaymentSerializer(many=True, read_only=True)

    amount_paid = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    balance = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    status = serializers.CharField(read_only=True)

    class Meta:
        model = Invoice
        fields = [
            "id", "student", "student_name", "fee_plan", "description", "amount",
            "issued_on", "due_on", "period_start", "period_end", "is_cancelled",
            "amount_paid", "balance", "status", "payments",
        ]
        read_only_fields = ["id", "student_name", "amount_paid", "balance", "status", "payments"]

    def validate_student(self, value):
        if value.organization_id != self.context["organization"].id:
            raise serializers.ValidationError("That student belongs to another organization.")
        return value

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Invoice amount must be greater than zero.")
        return value
