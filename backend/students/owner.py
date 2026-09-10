"""Whose personal records a fitness request is about.

These endpoints used to answer for `request.user.id`, which quietly meant a
trainer could only ever reach their own routines. A member's plan was
unreachable, because most members have no login for the key to point at.

Now the member is named. Staff name whoever they are working with; a member's
own app names themselves and the permission layer refuses anybody else.
"""

from rest_framework.exceptions import NotFound, ValidationError

from .models import Student


def named_student(request, academy, required=True):
    """The member this request is about, from `?student=` or the body.

    Scoped to the academy, so an id from another one is simply not found
    rather than confirmed to exist.
    """
    raw = (
        request.query_params.get("student")
        or (request.data.get("student") if hasattr(request, "data") else None)
    )
    if not raw:
        if required:
            raise ValidationError(
                {"student": "Say which member these records are for."}
            )
        return None

    student = Student.objects.filter(academy=academy, pk=raw).first()
    if student is None:
        raise NotFound("No such member.")
    return student


def own_student(request, academy, required=True):
    """The signed-in person's own record, never a named one.

    For data that stays private to the person it is about — body
    measurements and progress photos say so in their own models, and the
    planner is not a reason to quietly widen that.

    Reading without a record here is an empty answer, not an error: somebody
    who isn't a member of this academy simply has no body data at it. Writing
    without one is worth saying out loud.
    """
    student = Student.objects.filter(
        academy=academy, user_id=request.user.id
    ).first()
    if student is None and required:
        raise NotFound(
            "This is your own record, and you don't have one at this academy."
        )
    return student
