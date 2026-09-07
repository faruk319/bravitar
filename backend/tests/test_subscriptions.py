"""Membership tiers and subscriptions — the foundation the gym sits on.

Whether a member can walk in, how many classes they can book and when to
chase a renewal all read off these dates, so the arithmetic has to be right.
"""

from datetime import date, timedelta
from decimal import Decimal

from django.utils import timezone

from students.models import Student
from subscriptions.constants import BillingPeriod, SubscriptionStatus
from subscriptions.models import MemberSubscription, MembershipTier

from .base import TenantAPITestCase


class GymTestCase(TenantAPITestCase):
    def setUp(self):
        super().setUp()
        self.org.verticals = ["gym", "fitness"]
        self.org.save()
        self.today = timezone.localdate()
        self.student = Student.objects.create(
            organization=self.org, full_name="Walk In", joined_on=date(2026, 1, 1)
        )

    def make_tier(self, **overrides):
        fields = {
            "organization": self.org, "name": "Monthly",
            "period": BillingPeriod.MONTHLY, "duration_days": 30,
            "price": Decimal("1500.00"),
        }
        return MembershipTier.objects.create(**{**fields, **overrides})

    def default_tier(self):
        """One reusable tier — creating a fresh 'Monthly' per call would trip
        the tier-name uniqueness rule rather than test what we mean to."""
        if not hasattr(self, "_default_tier"):
            self._default_tier = self.make_tier()
        return self._default_tier

    def subscribe(self, tier=None, started_on=None, student=None):
        return self.client_for(self.manager).post(
            "/api/gym-ops/subscriptions/",
            {
                "student": (student or self.student).id,
                "tier": (tier or self.default_tier()).id,
                "started_on": str(started_on or self.today),
            },
            format="json",
        )


class TierTests(GymTestCase):
    def test_a_named_period_sets_its_own_length(self):
        response = self.client_for(self.manager).post(
            "/api/gym-ops/tiers/",
            {"name": "Yearly", "period": BillingPeriod.YEARLY, "price": "12000"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["duration_days"], 365)

    def test_a_custom_period_must_say_how_long(self):
        response = self.client_for(self.manager).post(
            "/api/gym-ops/tiers/",
            {"name": "Trial week", "period": BillingPeriod.CUSTOM, "price": "300"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("duration_days", response.data)

    def test_a_vip_tier_carries_what_it_includes(self):
        response = self.client_for(self.manager).post(
            "/api/gym-ops/tiers/",
            {
                "name": "VIP", "period": BillingPeriod.YEARLY, "price": "30000",
                "includes_personal_trainer": True, "class_credits_per_week": None,
                "perks": ["Locker", "Steam room", "Guest passes"],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data["includes_personal_trainer"])
        self.assertEqual(len(response.data["perks"]), 3)

    def test_tier_names_are_unique_within_an_academy(self):
        self.make_tier(name="Monthly")
        response = self.client_for(self.manager).post(
            "/api/gym-ops/tiers/",
            {"name": "Monthly", "period": BillingPeriod.MONTHLY, "price": "1"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_a_tier_in_use_is_retired_rather_than_deleted(self):
        """Deleting it would strand the memberships that reference it."""
        tier = self.make_tier()
        self.subscribe(tier=tier)

        response = self.client_for(self.manager).delete(f"/api/gym-ops/tiers/{tier.id}/")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Switch it off", str(response.data["detail"]))

        switched_off = self.client_for(self.manager).patch(
            f"/api/gym-ops/tiers/{tier.id}/", {"is_active": False}, format="json"
        )
        self.assertEqual(switched_off.status_code, 200)

    def test_an_unused_tier_can_be_deleted(self):
        tier = self.make_tier(name="Never sold")
        self.assertEqual(
            self.client_for(self.manager).delete(f"/api/gym-ops/tiers/{tier.id}/").status_code,
            204,
        )


class SubscriptionDateTests(GymTestCase):
    def test_expiry_is_worked_out_from_the_tier(self):
        response = self.subscribe(started_on=date(2026, 3, 1))
        self.assertEqual(response.status_code, 201)
        # A 30-day plan starting the 1st runs to the 30th, not the 31st.
        self.assertEqual(response.data["expires_on"], "2026-03-30")

    def test_the_price_defaults_to_the_tier(self):
        response = self.subscribe()
        self.assertEqual(Decimal(response.data["price_paid"]), Decimal("1500.00"))

    def test_a_yearly_plan_runs_a_year(self):
        yearly = self.make_tier(name="Yearly", period=BillingPeriod.YEARLY, price=Decimal("12000"))
        response = self.subscribe(tier=yearly, started_on=date(2026, 1, 1))
        self.assertEqual(response.data["expires_on"], "2026-12-31")

    def test_an_end_before_the_start_is_refused(self):
        tier = self.make_tier()
        response = self.client_for(self.manager).post(
            "/api/gym-ops/subscriptions/",
            {"student": self.student.id, "tier": tier.id,
             "started_on": "2026-03-10", "expires_on": "2026-03-01"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)


class SubscriptionStatusTests(GymTestCase):
    def make(self, starts_in, ends_in, cancelled=False):
        return MemberSubscription.objects.create(
            organization=self.org, student=self.student, tier=self.make_tier(
                name=f"Tier {starts_in}/{ends_in}"
            ),
            started_on=self.today + timedelta(days=starts_in),
            expires_on=self.today + timedelta(days=ends_in),
            price_paid=Decimal("1500"),
            cancelled_on=self.today if cancelled else None,
        )

    def test_status_is_derived_from_the_dates(self):
        self.assertEqual(self.make(-10, 20).status, SubscriptionStatus.ACTIVE)
        self.assertEqual(self.make(-40, -10).status, SubscriptionStatus.EXPIRED)
        self.assertEqual(self.make(5, 35).status, SubscriptionStatus.UPCOMING)

    def test_a_membership_inside_the_window_reads_as_expiring(self):
        self.assertEqual(self.make(-25, 3).status, SubscriptionStatus.EXPIRING)

    def test_cancelling_beats_the_dates(self):
        """A cancelled membership is cancelled even while its dates still run."""
        self.assertEqual(self.make(-5, 20, cancelled=True).status, SubscriptionStatus.CANCELLED)

    def test_expiring_still_lets_a_member_in(self):
        self.assertTrue(self.make(-25, 3).is_current)
        self.assertFalse(self.make(-40, -1).is_current)

    def test_the_last_day_still_counts(self):
        """Expiring today means today is still theirs."""
        subscription = self.make(-29, 0)
        self.assertEqual(subscription.days_remaining, 0)
        self.assertTrue(subscription.is_current)


class OverlapTests(GymTestCase):
    def test_two_live_memberships_are_refused(self):
        """Otherwise 'can they walk in' has two answers and the member is
        counted twice against tier numbers."""
        self.assertEqual(self.subscribe(started_on=self.today).status_code, 201)
        clash = self.subscribe(started_on=self.today + timedelta(days=5))
        self.assertEqual(clash.status_code, 400)
        self.assertIn("already has a membership", str(clash.data["student"]))

    def test_a_renewal_starting_after_the_last_one_ends_is_fine(self):
        first = self.subscribe(started_on=self.today)
        self.assertEqual(first.status_code, 201)
        renewal = self.subscribe(started_on=self.today + timedelta(days=30))
        self.assertEqual(renewal.status_code, 201)

    def test_a_cancelled_membership_does_not_block_a_new_one(self):
        first = self.subscribe(started_on=self.today)
        self.client_for(self.manager).patch(
            f"/api/gym-ops/subscriptions/{first.data['id']}/",
            {"cancelled_on": str(self.today)}, format="json",
        )
        self.assertEqual(self.subscribe(started_on=self.today).status_code, 201)


class ExpiryAlertTests(GymTestCase):
    def make_for(self, name, ends_in):
        student = Student.objects.create(
            organization=self.org, full_name=name, joined_on=date(2026, 1, 1),
            phone="9800000000",
        )
        MemberSubscription.objects.create(
            organization=self.org, student=student,
            tier=self.make_tier(name=f"Tier {name}"),
            started_on=self.today - timedelta(days=30),
            expires_on=self.today + timedelta(days=ends_in),
            price_paid=Decimal("1500"),
        )
        return student

    def test_it_finds_who_is_about_to_lapse(self):
        self.make_for("Lapsing", 3)
        self.make_for("Comfortable", 40)
        self.make_for("Already gone", -4)

        response = self.client_for(self.manager).get("/api/gym-ops/expiring/")
        expiring = [r["student_name"] for r in response.data["expiring"]]
        expired = [r["student_name"] for r in response.data["expired"]]

        self.assertEqual(expiring, ["Lapsing"])
        self.assertIn("Already gone", expired)
        self.assertNotIn("Comfortable", expiring + expired)

    def test_the_window_can_be_widened(self):
        self.make_for("Two weeks out", 12)
        narrow = self.client_for(self.manager).get("/api/gym-ops/expiring/")
        self.assertEqual(narrow.data["expiring"], [])

        wide = self.client_for(self.manager).get("/api/gym-ops/expiring/?days=14")
        self.assertEqual([r["student_name"] for r in wide.data["expiring"]], ["Two weeks out"])

    def test_it_carries_how_to_reach_them(self):
        """The list exists to be acted on, so it includes the contact details
        a reminder would go to."""
        self.make_for("Lapsing", 2)
        response = self.client_for(self.manager).get("/api/gym-ops/expiring/")
        self.assertEqual(response.data["expiring"][0]["phone"], "9800000000")

    def test_a_cancelled_membership_is_not_chased(self):
        student = self.make_for("Quit", 3)
        student.subscriptions.update(cancelled_on=self.today)
        response = self.client_for(self.manager).get("/api/gym-ops/expiring/")
        self.assertEqual(response.data["expiring"], [])


class OverviewTests(GymTestCase):
    def test_it_counts_current_members_and_their_value(self):
        monthly = self.make_tier(name="Monthly", price=Decimal("1500"))
        for name in ("A", "B"):
            student = Student.objects.create(
                organization=self.org, full_name=name, joined_on=date(2026, 1, 1)
            )
            MemberSubscription.objects.create(
                organization=self.org, student=student, tier=monthly,
                started_on=self.today - timedelta(days=5),
                expires_on=self.today + timedelta(days=25),
                price_paid=monthly.price,
            )

        response = self.client_for(self.manager).get("/api/gym-ops/overview/")
        self.assertEqual(response.data["current_members"], 2)
        self.assertEqual(response.data["value_on_current_memberships"], 3000.0)
        self.assertEqual(response.data["per_tier"][0]["members"], 2)

    def test_lapsed_members_are_not_counted_as_value(self):
        tier = self.make_tier(price=Decimal("1500"))
        student = Student.objects.create(
            organization=self.org, full_name="Gone", joined_on=date(2026, 1, 1)
        )
        MemberSubscription.objects.create(
            organization=self.org, student=student, tier=tier,
            started_on=self.today - timedelta(days=60),
            expires_on=self.today - timedelta(days=30),
            price_paid=tier.price,
        )
        response = self.client_for(self.manager).get("/api/gym-ops/overview/")
        self.assertEqual(response.data["current_members"], 0)
        self.assertEqual(response.data["value_on_current_memberships"], 0)


class GymGatingTests(GymTestCase):
    def test_an_academy_without_the_gym_vertical_is_refused(self):
        self.org.verticals = ["fitness"]
        self.org.save()
        self.assertEqual(
            self.client_for(self.manager).get("/api/gym-ops/tiers/").status_code, 403
        )

    def test_fitness_and_gym_are_independent(self):
        """A gym that doesn't track training keeps its memberships; a studio
        that only tracks training keeps its exercise library."""
        self.org.verticals = ["gym"]
        self.org.save()
        self.assertEqual(
            self.client_for(self.manager).get("/api/gym-ops/tiers/").status_code, 200
        )
        self.assertEqual(
            self.client_for(self.manager).get("/api/gym/exercises/").status_code, 403
        )

        self.org.verticals = ["fitness"]
        self.org.save()
        self.assertEqual(
            self.client_for(self.manager).get("/api/gym/exercises/").status_code, 200
        )


class MembershipBillingTests(GymTestCase):
    """Selling a membership has to raise a bill.

    Without this the Memberships screen and Fees & Billing show two unrelated
    sets of numbers, which is exactly how it read before — and is what made
    the two screens impossible to reconcile.
    """

    def test_starting_a_membership_raises_its_invoice(self):
        from billing.models import Invoice

        response = self.subscribe()
        self.assertEqual(response.status_code, 201)

        invoice = Invoice.objects.get(organization=self.org, student=self.student)
        self.assertEqual(invoice.amount, Decimal("1500.00"))
        self.assertEqual(invoice.subscription.id, response.data["id"])

    def test_the_invoice_says_what_it_is_for(self):
        response = self.subscribe(started_on=date(2026, 4, 1))
        from billing.models import Invoice

        invoice = Invoice.objects.get(subscription__id=response.data["id"])
        self.assertIn("Monthly membership", invoice.description)
        self.assertIn("2026-04-01", invoice.description)
        self.assertEqual(invoice.period_start, date(2026, 4, 1))
        self.assertEqual(invoice.period_end, date(2026, 4, 30))

    def test_the_fee_is_due_when_the_membership_starts(self):
        from billing.models import Invoice

        response = self.subscribe(started_on=self.today)
        invoice = Invoice.objects.get(subscription__id=response.data["id"])
        self.assertEqual(invoice.due_on, self.today)

    def test_the_membership_reports_what_is_still_owed(self):
        response = self.subscribe()
        self.assertEqual(response.data["invoice_status"], "unpaid")

        detail = self.client_for(self.manager).get(
            f"/api/gym-ops/subscriptions/{response.data['id']}/"
        )
        self.assertEqual(Decimal(detail.data["amount_due"]), Decimal("1500.00"))

    def test_paying_the_invoice_shows_on_the_membership(self):
        """The two screens are two views of one payment, not two tallies."""
        created = self.subscribe()
        invoice_id = self.client_for(self.manager).get(
            f"/api/gym-ops/subscriptions/{created.data['id']}/"
        ).data["invoice"]

        self.client_for(self.manager).post(
            "/api/billing/payments/",
            {"invoice": invoice_id, "amount": "1500.00", "paid_on": str(self.today)},
            format="json",
        )

        detail = self.client_for(self.manager).get(
            f"/api/gym-ops/subscriptions/{created.data['id']}/"
        )
        self.assertEqual(detail.data["invoice_status"], "paid")
        self.assertEqual(Decimal(detail.data["amount_due"]), Decimal("0.00"))

    def test_membership_money_appears_in_the_billing_totals(self):
        self.subscribe()
        summary = self.client_for(self.manager).get("/api/billing/summary/")
        self.assertEqual(Decimal(summary.data["billed"]), Decimal("1500.00"))

    def test_cancelling_an_unpaid_membership_drops_its_bill(self):
        """No point chasing someone who left before paying anything."""
        from billing.models import Invoice

        created = self.subscribe()
        self.client_for(self.manager).patch(
            f"/api/gym-ops/subscriptions/{created.data['id']}/",
            {"cancelled_on": str(self.today)}, format="json",
        )

        invoice = Invoice.objects.get(subscription__id=created.data["id"])
        self.assertTrue(invoice.is_cancelled)

        summary = self.client_for(self.manager).get("/api/billing/summary/")
        self.assertEqual(Decimal(summary.data["billed"]), Decimal("0.00"))

    def test_cancelling_a_part_paid_membership_keeps_its_bill(self):
        """Real money changed hands. Whether that becomes a refund or a
        credit is a person's decision, not something to quietly automate."""
        from billing.models import Invoice

        created = self.subscribe()
        invoice_id = self.client_for(self.manager).get(
            f"/api/gym-ops/subscriptions/{created.data['id']}/"
        ).data["invoice"]
        self.client_for(self.manager).post(
            "/api/billing/payments/",
            {"invoice": invoice_id, "amount": "500.00", "paid_on": str(self.today)},
            format="json",
        )

        self.client_for(self.manager).patch(
            f"/api/gym-ops/subscriptions/{created.data['id']}/",
            {"cancelled_on": str(self.today)}, format="json",
        )

        invoice = Invoice.objects.get(pk=invoice_id)
        self.assertFalse(invoice.is_cancelled)
        self.assertEqual(invoice.amount_paid, Decimal("500.00"))

    def test_a_membership_is_billed_once(self):
        from billing.models import Invoice

        created = self.subscribe()
        subscription = MemberSubscription.objects.get(pk=created.data["id"])
        subscription.raise_invoice()
        subscription.raise_invoice()

        self.assertEqual(
            Invoice.objects.filter(organization=self.org, student=self.student).count(), 1
        )
