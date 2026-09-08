from rest_framework import serializers

from students.models import Student

from .constants import BillingPeriod
from .models import MemberSubscription, MembershipTier


class MembershipTierSerializer(serializers.ModelSerializer):
    active_members = serializers.SerializerMethodField()

    class Meta:
        model = MembershipTier
        fields = [
            "id", "name", "description", "period", "duration_days", "price",
            "includes_personal_trainer", "class_credits_per_week", "perks",
            "is_active", "position", "active_members",
        ]
        read_only_fields = ["id", "active_members"]
        extra_kwargs = {"duration_days": {"required": False}}

    def get_active_members(self, obj):
        return sum(1 for s in obj.subscriptions.all() if s.is_current)

    def validate(self, attrs):
        period = attrs.get("period", getattr(self.instance, "period", BillingPeriod.MONTHLY))
        if period == BillingPeriod.CUSTOM and not attrs.get(
            "duration_days", getattr(self.instance, "duration_days", None)
        ):
            raise serializers.ValidationError(
                {"duration_days": "A custom period needs its length in days."}
            )
        # Named periods carry their own length; the model fills it in.
        attrs.setdefault("duration_days", BillingPeriod.DAYS.get(period, 30))
        return attrs

    def validate_price(self, value):
        if value < 0:
            raise serializers.ValidationError("Price can't be negative.")
        return value

    def validate_name(self, value):
        """The (organization, name) uniqueness can't be validated by DRF —
        organization isn't a serializer field, it comes from the tenant — so
        without this a duplicate name surfaces as a 500 from the database."""
        existing = MembershipTier.objects.filter(
            organization=self.context["organization"], name__iexact=value.strip()
        )
        if self.instance:
            existing = existing.exclude(pk=self.instance.pk)
        if existing.exists():
            raise serializers.ValidationError(f"There is already a tier called {value}.")
        return value.strip()


class MemberSubscriptionSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    tier_name = serializers.CharField(source="tier.name", read_only=True)
    status = serializers.CharField(read_only=True)
    days_remaining = serializers.IntegerField(read_only=True)
    invoice_status = serializers.SerializerMethodField()
    amount_due = serializers.SerializerMethodField()
    amount_paid = serializers.SerializerMethodField()

    class Meta:
        model = MemberSubscription
        fields = [
            "id", "student", "student_name", "tier", "tier_name",
            "started_on", "expires_on", "price_paid", "invoice",
            "cancelled_on", "notes", "status", "days_remaining",
            "invoice_status", "amount_due", "amount_paid",
        ]
        read_only_fields = [
            "id", "student_name", "tier_name", "status", "days_remaining",
            "invoice", "invoice_status", "amount_due", "amount_paid",
        ]
        # Worked out from the tier's length unless explicitly overridden.
        extra_kwargs = {
            "expires_on": {"required": False},
            "price_paid": {"required": False},
        }

    def get_invoice_status(self, obj):
        return obj.invoice.status if obj.invoice else None

    def get_amount_due(self, obj):
        return obj.invoice.balance if obj.invoice else None

    def get_amount_paid(self, obj):
        return obj.invoice.amount_paid if obj.invoice else None

    def validate_student(self, value):
        if value.organization_id != self.context["organization"].id:
            raise serializers.ValidationError("That member belongs to another organization.")
        return value

    def validate_tier(self, value):
        if value.organization_id != self.context["organization"].id:
            raise serializers.ValidationError("That tier belongs to another organization.")
        return value

    def validate(self, attrs):
        tier = attrs.get("tier") or getattr(self.instance, "tier", None)
        started = attrs.get("started_on") or getattr(self.instance, "started_on", None)

        if tier and started:
            attrs.setdefault("expires_on", MemberSubscription.expiry_for(tier, started))
            attrs.setdefault("price_paid", tier.price)

        expires = attrs.get("expires_on") or getattr(self.instance, "expires_on", None)
        if started and expires and expires < started:
            raise serializers.ValidationError(
                {"expires_on": "A membership can't end before it starts."}
            )

        # Two live memberships would make "can they walk in" ambiguous and
        # double-count the member against a tier.
        student = attrs.get("student") or getattr(self.instance, "student", None)
        if student and started and expires:
            clashing = MemberSubscription.objects.filter(
                student=student, cancelled_on__isnull=True,
                started_on__lte=expires, expires_on__gte=started,
            )
            if self.instance:
                clashing = clashing.exclude(pk=self.instance.pk)
            overlap = clashing.first()
            if overlap:
                raise serializers.ValidationError(
                    {"student": (
                        f"{student.full_name} already has a membership running "
                        f"{overlap.started_on} to {overlap.expires_on}. "
                        "Cancel it first, or start this one after it ends."
                    )}
                )
        return attrs
