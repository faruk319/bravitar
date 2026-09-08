"""Branch scoping: which locations of an academy a person may work in.

Rules, in the order they apply:

1. An academy with no branches has no branch scoping at all. Most academies
   are one place and should never have to think about this.
2. Owners see every branch.
3. Everyone else sees only the branches assigned to them. None assigned means
   nothing — access is granted, never assumed.
4. Records with no branch belong to the academy rather than to a location, so
   everyone sees them. Hiding them would make a walk-in unfindable at the desk
   and un-checkin-able at the door.

A model says where its branch lives via `BRANCH_FIELD` — "branch" when it owns
one, "student__branch" when it hangs off somebody who does. A model without
the attribute is not branch-scoped.
"""

from django.db.models import Q

from organizations.constants import Role
from organizations.models import Branch, Membership


def academy_has_branches(organization):
    return Branch.objects.filter(organization=organization).exists()


def allowed_branch_ids(request, organization):
    """Branch ids this caller may work in, or None for "no restriction".

    None and an empty set mean opposite things: None is an owner or a
    single-branch academy, empty is somebody nobody has assigned yet.
    """
    user = getattr(request, "user", None)

    # An API key acts for the whole academy — it has no person behind it to
    # assign branches to.
    if getattr(user, "is_api_key", False):
        return None
    if not academy_has_branches(organization):
        return None

    membership = Membership.objects.filter(
        organization=organization, user_id=getattr(user, "id", None) or ""
    ).first()
    if membership is None:
        return None  # Not a member; the membership permission refuses them.
    if membership.role == Role.OWNER:
        return None

    return set(membership.branches.values_list("id", flat=True))


def restrict(queryset, model, branch_ids):
    """Narrow `queryset` to `branch_ids`, keeping rows that have no branch."""
    field = getattr(model, "BRANCH_FIELD", None)
    if branch_ids is None or field is None:
        return queryset
    return queryset.filter(
        Q(**{f"{field}__in": branch_ids}) | Q(**{f"{field}__isnull": True})
    )


def may_use_branch(branch, branch_ids):
    """Whether a write may put a record in `branch`."""
    if branch_ids is None or branch is None:
        return True
    return branch.id in branch_ids
