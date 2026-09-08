def get_current_academy(request):
    """The Academy this request is scoped to, or None (signup, health check)."""
    return getattr(request, "tenant", None)


def get_current_organization(request):
    """The Organization the host resolved to. An academy always has one, so
    this is the academy's owner when there is an academy."""
    organization = getattr(request, "organization", None)
    if organization is not None:
        return organization
    academy = get_current_academy(request)
    return academy.organization if academy else None
