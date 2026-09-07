"""Builds a realistic academy so the cross-vertical core can be clicked through.

Idempotent by slug: re-running wipes and rebuilds the demo organization's
Phase 4 data, leaving every other organization untouched.
"""

import random
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from attendance.models import AttendanceRecord, AttendanceStatus
from batches.models import Batch, Enrolment
from billing.constants import BillingCycle, PaymentMethod
from billing.models import FeePlan, Invoice, Payment
from enquiries.constants import EnquirySource, EnquiryStatus
from enquiries.models import Enquiry
from organizations.constants import Role
from organizations.models import Branch, Membership, Organization
from students.constants import StudentStatus
from students.models import Student

FIRST_NAMES = [
    "Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Ayaan",
    "Krishna", "Ishaan", "Ananya", "Diya", "Aadhya", "Saanvi", "Myra", "Aarohi",
    "Anika", "Navya", "Kiara", "Ira", "Rohan", "Kabir", "Neha", "Priya",
    "Rahul", "Sneha", "Karan", "Meera", "Yash", "Tanvi",
]
LAST_NAMES = [
    "Sharma", "Verma", "Gupta", "Patel", "Reddy", "Nair", "Iyer", "Khan",
    "Singh", "Joshi", "Mehta", "Rao", "Desai", "Kulkarni", "Bose",
]


class Command(BaseCommand):
    help = "Seeds a demo academy with students, batches, attendance, fees and enquiries."

    def add_arguments(self, parser):
        parser.add_argument("--slug", default="demoacademy")
        parser.add_argument("--owner-email", default="demo.owner@example.com")
        parser.add_argument("--students", type=int, default=40)

    @transaction.atomic
    def handle(self, *args, **options):
        random.seed(42)
        slug = options["slug"]
        today = timezone.localdate()

        org, _ = Organization.objects.get_or_create(
            slug=slug,
            defaults={
                "name": "Demo Sports Academy",
                "verticals": ["gym", "swimming", "karate"],
            },
        )

        # Rebuild only this org's Phase 4 data so re-running stays clean.
        AttendanceRecord.objects.filter(organization=org).delete()
        Payment.objects.filter(invoice__organization=org).delete()
        Invoice.objects.filter(organization=org).delete()
        FeePlan.objects.filter(organization=org).delete()
        Enrolment.objects.filter(batch__organization=org).delete()
        Batch.objects.filter(organization=org).delete()
        Enquiry.objects.filter(organization=org).delete()
        Student.objects.filter(organization=org).delete()
        Branch.objects.filter(organization=org).delete()

        branches = [
            Branch.objects.create(organization=org, name="Andheri Branch",
                                  address="Andheri West, Mumbai", is_primary=True),
            Branch.objects.create(organization=org, name="Bandra Branch",
                                  address="Bandra East, Mumbai"),
        ]

        plans = {
            "gym": FeePlan.objects.create(organization=org, name="Gym — Monthly",
                                          amount=Decimal("1500.00"), cycle=BillingCycle.MONTHLY),
            "swim": FeePlan.objects.create(organization=org, name="Swimming — Quarterly",
                                           amount=Decimal("4500.00"), cycle=BillingCycle.QUARTERLY),
            "karate": FeePlan.objects.create(organization=org, name="Karate — Monthly",
                                             amount=Decimal("1200.00"), cycle=BillingCycle.MONTHLY),
        }

        batch_specs = [
            ("Morning Gym", [0, 2, 4], "06:00", "07:30", 25, branches[0], "gym"),
            ("Evening Gym", [0, 1, 2, 3, 4], "18:00", "20:00", 30, branches[0], "gym"),
            ("Beginner Swimming", [1, 3], "07:00", "08:00", 12, branches[0], "swim"),
            ("Advanced Swimming", [1, 3, 5], "17:00", "18:30", 10, branches[1], "swim"),
            ("Karate — White Belt", [5, 6], "09:00", "10:30", 20, branches[1], "karate"),
        ]
        batches = []
        for name, days, start, end, cap, branch, plan_key in batch_specs:
            batches.append((
                Batch.objects.create(
                    organization=org, branch=branch, name=name, days_of_week=days,
                    start_time=start, end_time=end, capacity=cap,
                    coach_name=random.choice(["Coach Ramesh", "Coach Fatima", "Coach Dev"]),
                ),
                plan_key,
            ))

        students = []
        for i in range(options["students"]):
            joined = today - timedelta(days=random.randint(10, 400))
            students.append(Student.objects.create(
                organization=org,
                branch=random.choice(branches),
                full_name=f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}",
                phone=f"98{random.randint(10000000, 99999999)}",
                email=f"student{i + 1}@example.com",
                status=random.choices(
                    [StudentStatus.ACTIVE, StudentStatus.TRIAL, StudentStatus.PAUSED, StudentStatus.LEFT],
                    weights=[75, 10, 8, 7],
                )[0],
                joined_on=joined,
            ))

        # Enrol active students into batches at their own branch.
        enrolments = []
        for student in students:
            if student.status == StudentStatus.LEFT:
                continue
            options_for_branch = [b for b, _ in batches if b.branch_id == student.branch_id]
            for batch in random.sample(options_for_branch, k=min(len(options_for_branch),
                                                                 random.choice([1, 1, 2]))):
                if batch.enrolments.filter(is_active=True).count() >= (batch.capacity or 999):
                    continue
                enrolments.append(Enrolment.objects.create(
                    batch=batch, student=student,
                    enrolled_on=max(student.joined_on, today - timedelta(days=120)),
                ))

        # Attendance for the last 8 weeks, on days each batch actually runs.
        marks = 0
        for enrolment in enrolments:
            batch = enrolment.batch
            for offset in range(56, 0, -1):
                day = today - timedelta(days=offset)
                if day.weekday() not in batch.days_of_week or day < enrolment.enrolled_on:
                    continue
                status = random.choices(
                    [AttendanceStatus.PRESENT, AttendanceStatus.ABSENT,
                     AttendanceStatus.LATE, AttendanceStatus.EXCUSED],
                    weights=[76, 14, 7, 3],
                )[0]
                AttendanceRecord.objects.update_or_create(
                    organization=org, batch=batch, student=enrolment.student, date=day,
                    defaults={"status": status, "marked_by": "seed"},
                )
                marks += 1

        # Invoices for the last three months, with a realistic mix of paid,
        # partly paid, unpaid and overdue.
        invoices = payments = 0
        for enrolment in {e.student_id: e for e in enrolments}.values():
            student = enrolment.student
            plan = plans[dict(batches)[enrolment.batch]]
            for months_ago in (2, 1, 0):
                issued = (today.replace(day=1) - timedelta(days=months_ago * 30)).replace(day=1)
                if issued < student.joined_on:
                    continue
                invoice = Invoice.objects.create(
                    organization=org, student=student, fee_plan=plan,
                    description=f"{plan.name} — {issued:%B %Y}",
                    amount=plan.amount, issued_on=issued,
                    due_on=issued + timedelta(days=10),
                    period_start=issued, period_end=issued + timedelta(days=29),
                )
                invoices += 1

                outcome = random.choices(["paid", "partial", "unpaid"],
                                         weights=[70, 12, 18])[0]
                if outcome == "paid":
                    Payment.objects.create(
                        invoice=invoice, amount=invoice.amount,
                        paid_on=min(invoice.due_on, today),
                        method=random.choice(PaymentMethod.VALUES), recorded_by="seed")
                    payments += 1
                elif outcome == "partial":
                    Payment.objects.create(
                        invoice=invoice, amount=(invoice.amount / 2).quantize(Decimal("0.01")),
                        paid_on=min(invoice.due_on, today),
                        method=random.choice(PaymentMethod.VALUES), recorded_by="seed")
                    payments += 1

        # Enquiry pipeline, including a few already converted.
        enquiry_count = 0
        for i in range(26):
            created = today - timedelta(days=random.randint(0, 60))
            status = random.choices(
                EnquiryStatus.VALUES, weights=[22, 20, 14, 10, 24, 10])[0]
            enquiry = Enquiry.objects.create(
                organization=org, branch=random.choice(branches),
                name=f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}",
                phone=f"97{random.randint(10000000, 99999999)}",
                source=random.choice(EnquirySource.VALUES),
                interested_in=random.choice(["gym", "swimming", "karate"]),
                status=status,
                trial_on=created + timedelta(days=3) if status in (
                    EnquiryStatus.TRIAL_SCHEDULED, EnquiryStatus.TRIAL_DONE) else None,
                follow_up_on=created + timedelta(days=2) if status in EnquiryStatus.OPEN else None,
                notes="Asked about timings and fees.",
            )
            Enquiry.objects.filter(pk=enquiry.pk).update(created_at=timezone.now() - timedelta(
                days=(today - created).days))

            if status == EnquiryStatus.CONVERTED:
                student = Student.objects.create(
                    organization=org, branch=enquiry.branch, full_name=enquiry.name,
                    phone=enquiry.phone, status=StudentStatus.ACTIVE,
                    joined_on=created + timedelta(days=5),
                )
                enquiry.converted_student = student
                enquiry.save(update_fields=["converted_student"])
            enquiry_count += 1

        owner = Membership.objects.filter(organization=org, role=Role.OWNER).first()

        self.stdout.write(self.style.SUCCESS(
            f"Demo academy '{org.name}' ({org.slug}) rebuilt:\n"
            f"  branches   {len(branches)}\n"
            f"  students   {Student.objects.filter(organization=org).count()}\n"
            f"  batches    {len(batches)}\n"
            f"  enrolments {len(enrolments)}\n"
            f"  attendance {marks}\n"
            f"  invoices   {invoices} ({payments} with payments)\n"
            f"  enquiries  {enquiry_count}\n"
        ))
        if owner:
            self.stdout.write(f"  owner      {owner.email}")
        else:
            self.stdout.write(self.style.WARNING(
                f"  No owner yet — sign up, then attach a Membership for slug '{slug}'."))
