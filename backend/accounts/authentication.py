import jwt
from django.conf import settings
from rest_framework import authentication, exceptions


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

        if not settings.SUPABASE_JWT_SECRET:
            raise exceptions.AuthenticationFailed("Supabase JWT secret is not configured.")

        try:
            claims = jwt.decode(
                token,
                settings.SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated",
            )
        except jwt.PyJWTError as exc:
            raise exceptions.AuthenticationFailed(f"Invalid token: {exc}")

        return (SupabaseUser(claims), token)
