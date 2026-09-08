"""Which academies a request works on.

The host names the organization. `X-Academy` then names one academy inside it,
or `all` for every one — the owner's view across their whole business. Anyone
else always works in exactly one academy, because a manager's screens should
never quietly mix two sets of books.

Writes need a single academy whatever the reader chose: a new member has to
land somewhere, and "all" doesn't say where.
"""

from organizations.constants import Role
from organizations.models import Academy, Membership

ALL = "all"


def _is_owner(request, organization):
    if getattr(request.user, "is_api_key", False):
        return False
    return Membership.objects.filter(
        organization=organization, user_id=getattr(request.user, "id", None) or "",
        role=Role.OWNER,
    ).exists()


def academies_in_scope(request):
    """The academies this request reads from. Empty when nothing resolved."""
    organization = getattr(request, "organization", None)
    if organization is None:
        return Academy.objects.none()

    wanted = (request.headers.get("X-Academy") or "").strip()
    everything = Academy.objects.filter(organization=organization)

    if wanted.lower() == ALL:
        return everything if _is_owner(request, organization) else Academy.objects.none()

    academy = getattr(request, "tenant", None)
    return everything.filter(pk=academy.pk) if academy else Academy.objects.none()


def single_academy(request):
    """The one academy a write lands in, or None if the caller hasn't said."""
    return getattr(request, "tenant", None)


def verticals_in_scope(request):
    """What is switched on across the academies in scope. A gate passes when
    any academy being looked at runs that sport."""
    seen = []
    for academy in academies_in_scope(request):
        for vertical in academy.verticals or []:
            if vertical not in seen:
                seen.append(vertical)
    return seen
