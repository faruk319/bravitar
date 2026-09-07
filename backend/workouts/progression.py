"""Turns last session's performance into next session's targets.

Each rule takes the routine's targets plus the sets actually logged last time
(warm-ups already excluded) and returns a suggestion. Nothing here writes to
the database — the suggestion is advice shown to the lifter, who is free to
log something else.
"""

from decimal import Decimal

from .constants import ProgressionRule


def _all_sets_hit_target(last_sets, target_reps):
    return bool(last_sets) and all(s.reps >= target_reps for s in last_sets)


def suggest(item, last_sets, rule, increment):
    """item: RoutineExercise, last_sets: list[SetLog] from the most recent
    session for that exercise, ordered by set number.

    Returns {"weight": Decimal|None, "reps": int, "reason": str}.
    """
    target_reps = item.target_reps
    top_reps = item.target_reps_max or item.target_reps
    last_weight = next((s.weight for s in reversed(last_sets) if s.weight is not None), None)
    base_weight = last_weight if last_weight is not None else item.target_weight

    if not last_sets:
        return {
            "weight": item.target_weight,
            "reps": target_reps,
            "reason": "First time — starting from the routine's target.",
        }

    if rule == ProgressionRule.LINEAR:
        if _all_sets_hit_target(last_sets, target_reps) and base_weight is not None:
            return {
                "weight": base_weight + increment,
                "reps": target_reps,
                "reason": f"Every set hit {target_reps} last time — adding {increment}.",
            }
        return {
            "weight": base_weight,
            "reps": target_reps,
            "reason": "Missed some reps last time — repeating the same weight.",
        }

    if rule == ProgressionRule.DOUBLE:
        if _all_sets_hit_target(last_sets, top_reps) and base_weight is not None:
            return {
                "weight": base_weight + increment,
                "reps": target_reps,
                "reason": f"Hit the top of the range ({top_reps}) — adding {increment} and resetting reps.",
            }
        next_reps = min(max(s.reps for s in last_sets) + 1, top_reps)
        return {
            "weight": base_weight,
            "reps": next_reps,
            "reason": f"Working up the rep range toward {top_reps}.",
        }

    if rule == ProgressionRule.GREYSKULL:
        amrap_reps = last_sets[-1].reps
        if base_weight is None:
            return {"weight": None, "reps": target_reps, "reason": "No weight logged yet."}
        if amrap_reps >= target_reps * 2:
            return {
                "weight": base_weight + increment * 2,
                "reps": target_reps,
                "reason": f"Last set got {amrap_reps} reps — double jump.",
            }
        if amrap_reps >= target_reps:
            return {
                "weight": base_weight + increment,
                "reps": target_reps,
                "reason": f"Last set got {amrap_reps} reps — adding {increment}.",
            }
        return {
            "weight": (base_weight * Decimal("0.9")).quantize(Decimal("0.01")),
            "reps": target_reps,
            "reason": f"Only {amrap_reps} reps last time — deloading 10%.",
        }

    return {
        "weight": base_weight,
        "reps": target_reps,
        "reason": "Repeating last session.",
    }
