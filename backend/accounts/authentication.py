import jwt
from django.conf import settings
from rest_framework import authentication, exceptions

_jwks_client = None


def _get_jwks_client():
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = jwt.PyJWKClient(
            f"{settings.SUPABASE_URL}/auth/v1/.well-known/jwks.json",
            cache_keys=True,
        )
    return _jwks_client


class SupabaseUser:
    """Lightweight authenticated-user stand-in backed by a verified Supabase JWT.

    Phase 1 will link this to an Organization/role; for now it just exposes
    the claims needed to prove auth is wired up end-to-end.
    """

    is_authenticated = True

    def __init__(self, claims):
        self.claims = claims
        self.id = claims.get("sub")
        self.email = claims.get("email")
        # Whether Supabase has confirmed this address. Claiming an invitation
        # depends on it: without the check, anyone could sign up using an
        # invited address and take that role.
        metadata = claims.get("user_metadata") or {}
        self.email_verified = bool(
            claims.get("email_verified") or metadata.get("email_verified")
        )

    @property
    def pk(self):
        """DRF's UserRateThrottle keys its bucket on `user.pk`. There's no
        Django row behind this user, so the Supabase id is the identity."""
        return self.id

    def __str__(self):
        return self.email or self.id or "supabase-user"


class SupabaseJWTAuthentication(authentication.BaseAuthentication):
    """Verifies the Supabase-issued JWT sent in the Authorization header."""

    keyword = "Bearer"

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).split()

        if not header or header[0].decode().lower() != self.keyword.lower():
            return None

        if len(header) != 2:
            raise exceptions.AuthenticationFailed("Invalid Authorization header.")

        token = header[1].decode()

        try:
            unverified_header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as exc:
            raise exceptions.AuthenticationFailed(f"Malformed token: {exc}")

        # Supabase projects sign with an asymmetric key (ES256/RS256, verified
        # via JWKS) by default; older projects may still use the legacy
        # shared HS256 secret. Support both.
        if unverified_header.get("alg") == "HS256":
            if not settings.SUPABASE_JWT_SECRET:
                raise exceptions.AuthenticationFailed("Supabase JWT secret is not configured.")
            key = settings.SUPABASE_JWT_SECRET
            algorithms = ["HS256"]
        else:
            if not settings.SUPABASE_URL:
                raise exceptions.AuthenticationFailed("SUPABASE_URL is not configured.")
            try:
                key = _get_jwks_client().get_signing_key_from_jwt(token).key
            except jwt.PyJWKClientError as exc:
                raise exceptions.AuthenticationFailed(f"Unable to fetch signing key: {exc}")
            algorithms = ["ES256", "RS256"]

        try:
            claims = jwt.decode(token, key, algorithms=algorithms, audience="authenticated")
        except jwt.PyJWTError as exc:
            raise exceptions.AuthenticationFailed(f"Invalid token: {exc}")

        return (SupabaseUser(claims), token)
