from django.conf import settings

from organizations.models import APIKey, Organization


class TenantResolutionMiddleware:
    """Resolves the Organization a request belongs to, from (in order):

    1. `X-API-Key` header — headless API access, scopes to the key's org.
    2. `Host` header exact match against an Organization's verified custom_domain
       — white-labeled frontend.
    3. `Host` header subdomain (`<slug>.<DJANGO_BASE_DOMAIN>`) — standard
       Bravitar-hosted frontend.

    Sets `request.tenant` (Organization | None) and `request.tenant_source`.
    Never blocks the request — routes that require a tenant should check
    `request.tenant` themselves (see tenants.permissions).
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.tenant, request.tenant_source = self._resolve(request)
        return self.get_response(request)

    def _resolve(self, request):
        api_key_header = request.headers.get("X-API-Key")
        if api_key_header:
            api_key = APIKey.resolve(api_key_header)
            if api_key:
                return api_key.organization, "api_key"
            return None, None

        host = request.get_host().split(":")[0].lower()

        try:
            org = Organization.objects.get(custom_domain=host, domain_verified=True)
            return org, "custom_domain"
        except Organization.DoesNotExist:
            pass

        base_domain = settings.BASE_DOMAIN
        if base_domain and host.endswith(f".{base_domain}"):
            slug = host[: -len(f".{base_domain}")]
            try:
                org = Organization.objects.get(slug=slug)
                return org, "subdomain"
            except Organization.DoesNotExist:
                pass

        return None, None
