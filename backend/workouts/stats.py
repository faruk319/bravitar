"""Aggregations over logged sets: what got trained, how hard, and when.

Everything here is derived from SetLog — there is no separate stats table, so
the numbers can never drift from the log they describe.
"""

from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from django.db.models import Count
from django.db.models.functions import TruncDate
from django.utils import timezone

from exercises.constants import Muscle

# A set trains its primary muscle directly and its secondary muscles as
# assistance. Counting assistance work at full weight would make a bench press
# look like a triceps session; ignoring it entirely hides real volume.
SECONDARY_CREDIT = Decimal("0.5")


def _volume(set_log):
    """Tonnage: reps x weight. Bodyweight sets have no weight, so they carry
    no tonnage — they still count as sets, which is why both are reported."""
    if set_log.weight is None:
        return Decimal(0)
    return Decimal(set_log.reps) * set_log.weight


def muscle_breakdown(working_sets, now=None):
    """Per-muscle volume, set count, best e1RM and days since last trained.

    Feeds all three muscle-map views: balance (share of volume), fatigue
    (how recently), and strength (best e1RM).
    """
    now = now or timezone.now()

    volume = defaultdict(Decimal)
    sets = defaultdict(Decimal)
    best_1rm = {}
    last_trained = {}

    for set_log in working_sets:
        exercise = set_log.exercise
        contributions = [(exercise.primary_muscle, Decimal(1))]
        contributions += [
            (muscle, SECONDARY_CREDIT)
            for muscle in (exercise.secondary_muscles or [])
            if muscle in Muscle.VALUES
        ]

        set_volume = _volume(set_log)

        for muscle, weight in contributions:
            volume[muscle] += set_volume * weight
            sets[muscle] += weight

            if set_log.estimated_1rm is not None:
                current = best_1rm.get(muscle)
                if current is None or set_log.estimated_1rm > current:
                    best_1rm[muscle] = set_log.estimated_1rm

            trained_at = set_log.session.started_at
            if muscle not in last_trained or trained_at > last_trained[muscle]:
                last_trained[muscle] = trained_at

    total_volume = sum(volume.values()) or Decimal(1)

    return [
        {
            "muscle": value,
            "label": label,
            "volume": round(volume.get(value, Decimal(0)), 1),
            "share": round(float(volume.get(value, Decimal(0)) / total_volume), 4),
            "sets": float(sets.get(value, Decimal(0))),
            "best_estimated_1rm": best_1rm.get(value),
            "days_since": (
                (now - last_trained[value]).days if value in last_trained else None
            ),
        }
        for value, label in Muscle.CHOICES
        if value != Muscle.FULL_BODY or value in volume
    ]


def activity_calendar(sessions_queryset, start, end):
    """Sessions and sets per day, with every day in the window present so the
    heatmap has no gaps to guess at."""
    rows = (
        sessions_queryset.filter(started_at__date__gte=start, started_at__date__lte=end)
        .annotate(day=TruncDate("started_at"))
        .values("day")
        .annotate(sessions=Count("id", distinct=True), sets=Count("sets"))
        .order_by("day")
    )
    by_day = {row["day"]: row for row in rows}

    days = []
    current = start
    while current <= end:
        row = by_day.get(current)
        days.append(
            {
                "date": current,
                "sessions": row["sessions"] if row else 0,
                "sets": row["sets"] if row else 0,
            }
        )
        current += timedelta(days=1)
    return days


def training_totals(sessions_queryset):
    aggregate = sessions_queryset.aggregate(
        sessions=Count("id", distinct=True), sets=Count("sets")
    )
    return {"sessions": aggregate["sessions"] or 0, "sets": aggregate["sets"] or 0}
