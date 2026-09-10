from django.db import models

from organizations.models import Academy, Branch
from students.models import Student


class Batch(models.Model):
    """A recurring class or training group. Generic across verticals — a swim
    lane, a karate belt group and a gym slot are all batches."""

    BRANCH_FIELD = "branch"

    academy = models.ForeignKey(Academy, on_delete=models.CASCADE, related_name="batches")
    branch = models.ForeignKey(
        Branch, on_delete=models.SET_NULL, related_name="batches", null=True, blank=True
    )

    name = models.CharField(max_length=255)
    description = models.CharField(max_length=500, blank=True)
    # Was a free-text name, which could not be paid, scheduled or held to
    # anything. Kept for rows written before there was somebody to point at.
    coach = models.ForeignKey(
        "organizations.Membership", on_delete=models.SET_NULL,
        related_name="batches_coached", null=True, blank=True,
    )
    coach_name = models.CharField(max_length=255, blank=True)

    # 0 = Monday .. 6 = Sunday, matching Python's weekday().
    days_of_week = models.JSONField(default=list, blank=True)
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    capacity = models.PositiveSmallIntegerField(null=True, blank=True)

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "batches"

    def __str__(self):
        return self.name

    @property
    def enrolled_count(self):
        return self.enrolments.filter(is_active=True).count()


class Enrolment(models.Model):
    """Links a student to a batch. Kept as its own row rather than a
    many-to-many so leaving a batch is recorded, not erased."""

    BRANCH_FIELD = "batch__branch"

    batch = models.ForeignKey(Batch, on_delete=models.CASCADE, related_name="enrolments")
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="enrolments")

    enrolled_on = models.DateField()
    left_on = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["-enrolled_on", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["batch", "student"],
                condition=models.Q(is_active=True),
                name="one_active_enrolment_per_student_per_batch",
            )
        ]

    def __str__(self):
        return f"{self.student.full_name} in {self.batch.name}"


class BookingStatus:
    """A place in one session.

    `waitlisted` is a real place in a queue, not a failed booking — when
    somebody cancels, the first person waiting takes their place.

    `skipped` is the opposite: a regular of the batch saying they are not
    coming that day. They hold a place by default, so the only way to give
    it up is to say so.
    """

    BOOKED = "booked"
    WAITLISTED = "waitlisted"
    CANCELLED = "cancelled"
    SKIPPED = "skipped"
    ATTENDED = "attended"
    NO_SHOW = "no_show"

    CHOICES = [
        (BOOKED, "Booked"),
        (WAITLISTED, "Waiting"),
        (CANCELLED, "Cancelled"),
        (SKIPPED, "Not coming"),
        (ATTENDED, "Attended"),
        (NO_SHOW, "Didn't turn up"),
    ]
    # Holding a place, or waiting for one.
    OPEN = [BOOKED, WAITLISTED]
    # Took up a place on the day. A regular's place is counted from their
    # enrolment, not from a row, so `booked` here means a drop-in only.
    TOOK_PLACE = [BOOKED, ATTENDED, NO_SHOW]


class ClassBooking(models.Model):
    """One member's place in one session of a batch.

    Separate from Enrolment, which says somebody is in a batch generally. A
    booking is for a date: it is what capacity and class credits are counted
    against, and what a waitlist queues for.
    """

    BRANCH_FIELD = "batch__branch"

    academy = models.ForeignKey(
        Academy, on_delete=models.CASCADE, related_name="class_bookings"
    )
    batch = models.ForeignKey(Batch, on_delete=models.CASCADE, related_name="bookings")
    student = models.ForeignKey(
        Student, on_delete=models.CASCADE, related_name="class_bookings"
    )
    session_date = models.DateField()

    status = models.CharField(
        max_length=20, choices=BookingStatus.CHOICES, default=BookingStatus.BOOKED
    )
    booked_at = models.DateTimeField(auto_now_add=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["session_date", "booked_at", "id"]
        indexes = [models.Index(fields=["batch", "session_date"])]
        constraints = [
            models.UniqueConstraint(
                fields=["batch", "student", "session_date"],
                condition=models.Q(status__in=["booked", "waitlisted"]),
                name="one_open_booking_per_session",
            )
        ]

    def __str__(self):
        return f"{self.student.full_name} — {self.batch.name} on {self.session_date}"

    @property
    def is_open(self):
        return self.status in BookingStatus.OPEN

    @classmethod
    def drop_ins(cls, batch, session_date):
        """Places held by somebody booked for that one day."""
        return cls.objects.filter(
            batch=batch, session_date=session_date, status=BookingStatus.BOOKED
        ).count()

    @classmethod
    def places_taken(cls, batch, session_date):
        """Everyone holding a place: the batch's regulars, less whoever said
        they aren't coming, plus that day's drop-ins.

        A regular holds their place without a row — the roster already says
        they are expected. Rows exist only where somebody departs from that.
        """
        skipped = cls.objects.filter(
            batch=batch, session_date=session_date, status=BookingStatus.SKIPPED
        ).count()
        return (
            regulars_on(batch, session_date).count()
            - skipped
            + cls.drop_ins(batch, session_date)
        )

    @classmethod
    def waiting(cls, batch, session_date):
        return cls.objects.filter(
            batch=batch, session_date=session_date, status=BookingStatus.WAITLISTED
        ).order_by("booked_at", "id")

    @classmethod
    def mark_skip(cls, batch, student, session_date):
        """A regular saying they aren't coming. Frees their place for the day.

        Returns the row and whoever was promoted off the waitlist by it.
        """
        existing = cls.objects.filter(
            batch=batch, student=student, session_date=session_date,
            status=BookingStatus.SKIPPED,
        ).first()
        if existing:
            return existing, None

        row = cls.objects.create(
            academy_id=batch.academy_id, batch=batch, student=student,
            session_date=session_date, status=BookingStatus.SKIPPED,
        )
        return row, row.promote_from_waitlist()

    def unskip(self):
        """Take the place back. Refused if it has gone in the meantime."""
        if self.status != BookingStatus.SKIPPED:
            return False
        capacity = self.batch.capacity
        if capacity is not None and ClassBooking.places_taken(
            self.batch, self.session_date
        ) >= capacity:
            return False
        self.delete()
        return True

    def cancel(self):
        """Give the place up, and hand it to whoever is waiting."""
        from django.utils import timezone

        was_booked = self.status == BookingStatus.BOOKED
        self.status = BookingStatus.CANCELLED
        self.cancelled_at = timezone.now()
        self.save(update_fields=["status", "cancelled_at"])

        return self.promote_from_waitlist() if was_booked else None

    def promote_from_waitlist(self):
        """The first person waiting who is still within their allowance.

        Waiting doesn't spend a credit — somebody waitlisted for three classes
        and given none should not have paid for three — so the allowance is
        checked here instead, and anyone now over it is passed over rather
        than being given a place they can't keep.
        """
        from .allowance import classes_allowed_per_week

        if self.batch.capacity is None:
            return None
        if ClassBooking.places_taken(self.batch, self.session_date) >= self.batch.capacity:
            return None

        for candidate in ClassBooking.waiting(self.batch, self.session_date):
            allowed = classes_allowed_per_week(candidate.student)
            if allowed is not None and booked_that_week(
                candidate.student, self.session_date
            ) >= allowed:
                continue
            candidate.status = BookingStatus.BOOKED
            candidate.save(update_fields=["status"])
            return candidate
        return None


def regulars_on(batch, day):
    """Enrolments that were running on `day`.

    Date-bounded rather than just `is_active`, so a session next month does
    not count somebody who leaves next week, and last month's session still
    counts whoever was there at the time.
    """
    return Enrolment.objects.filter(
        batch=batch, is_active=True, enrolled_on__lte=day
    ).filter(models.Q(left_on__isnull=True) | models.Q(left_on__gte=day))


def is_regular(batch, student, day):
    return regulars_on(batch, day).filter(student=student).exists()


def week_of(day):
    """Monday to Sunday around `day` — the window a weekly allowance counts in."""
    from datetime import timedelta

    monday = day - timedelta(days=day.weekday())
    return monday, monday + timedelta(days=6)


def booked_that_week(student, day):
    start, end = week_of(day)
    return ClassBooking.objects.filter(
        student=student,
        session_date__range=(start, end),
        status__in=BookingStatus.TOOK_PLACE,
    ).count()
