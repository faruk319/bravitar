"""Turning an invitation into a real membership.

An owner invites by email before that person has an account. When they first
sign in, the pending row is matched to their Supabase user id.
"""

from django.utils import timezone

from .models import Membership


def claim_pending_memberships(user):
    """Attaches any invitations addressed to this person to their account.

    Gated on Supabase having confirmed the address. Without that check,
    signing up with someone else's invited email would hand over their role —
    so an unverified address claims nothing.

    Returns the number of invitations claimed. Safe to call repeatedly.
    """
    email = (getattr(user, "email", "") or "").strip()
    if not email or not getattr(user, "email_verified", False):
        return 0

    return Membership.objects.filter(email__iexact=email, user_id="").update(
        user_id=user.id, joined_at=timezone.now()
    )
