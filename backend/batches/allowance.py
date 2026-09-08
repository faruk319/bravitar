"""How many classes a member may book in a week.

Core doesn't know what a membership is. A vertical that sells class credits
registers a rule here from its AppConfig, the same way the door's admission
rule is plugged in.
"""

_RULES = {}


def register_rule(vertical, rule):
    """`rule(student)` returns a weekly allowance, or None for unlimited."""
    _RULES[vertical] = rule


def classes_allowed_per_week(student):
    """The tightest allowance any vertical puts on them, or None for no limit."""
    limits = []
    for vertical in student.academy.verticals or []:
        rule = _RULES.get(vertical)
        if rule is None:
            continue
        limit = rule(student)
        if limit is not None:
            limits.append(limit)
    return min(limits) if limits else None
