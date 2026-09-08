from django.conf import settings

from organizations.models import Academy, APIKey, Organization


class TenantResolutionMiddleware:
    """Resolves the Organization a request belongs to, then the Academy inside it.

    The Organization comes from, in order:

    1. `X-API-Key` — headless access, scoped to the key's organization.
    2. `Host` matching a verified custom_domain — white-labelled frontend.
    3. `Host` subdomain (`<slug>.<DJANGO_BASE_DOMAIN>`).

    The Academy then comes from `X-Academy` (slug or id), or the organization's
    only academy. An organization with several academies and no header gets
    none — picking one for the caller would silently show the wrong books.

    Sets `request.organization`, `request.tenant` (the Academy) and
    `request.tenant_source`. Never blocks; routes that need a tenant check
    `request.tenant` themselves.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        organization, source = self._resolve_organization(request)
        request.organization = organization
        request.tenant_source = source
        request.tenant = self._resolve_academy(request, organization)
        return self.get_response(request)

    def _resolve_organization(self, request):
        api_key_header = request.headers.get("X-API-Key")
        if api_key_header:
            api_key = APIKey.resolve(api_key_header)
            return (api_key.organization, "api_key") if api_key else (None, None)

        host = request.get_host().split(":")[0].lower()

        organization = Organization.objects.filter(
            custom_domain=host, domain_verified=True
        ).first()
        if organization:
            return organization, "custom_domain"

        base_domain = settings.BASE_DOMAIN
        if base_domain and host.endswith(f".{base_domain}"):
            slug = host[: -len(f".{base_domain}")]
            organization = Organization.objects.filter(slug=slug).first()
            if organization:
                return organization, "subdomain"

        return None, None

    def _resolve_academy(self, request, organization):
        """Also sets `request.academy_named_but_missing` — a header naming an
        academy that isn't in this organization is refused rather than quietly
        ignored, since silently falling back would hide the mistake."""
        request.academy_named_but_missing = False
        if organization is None:
            return None

        academies = Academy.objects.filter(organization=organization)
        wanted = (request.headers.get("X-Academy") or "").strip()

        if wanted and wanted.lower() != "all":
            found = academies.filter(slug=wanted).first()
            if found is None and wanted.isdigit():
                found = academies.filter(pk=wanted).first()
            request.academy_named_but_missing = found is None
            return found

        if wanted.lower() == "all":
            return None  # scope.py decides whether they may look at all of it

        # One academy is the common case; more than one and the caller has to say.
        return academies.first() if academies.count() == 1 else None
