def get_current_organization(request):
    """Returns the Academy resolved by TenantResolutionMiddleware, or
    None if this request isn't scoped to one (e.g. signup, health check)."""
    return getattr(request, "tenant", None)
