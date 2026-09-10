"""Turning an invitation into a member's own login.

Mirrors organizations/invitations.py, with one deliberate difference: a
Membership *is* the invitation, so creating one is enough. A Student's email
is a contact detail the desk typed in at sign-up, so it grants nothing until
somebody actually invites them.
"""

from django.utils import timezone

from .models import Student


def claim_pending_students(user):
    """Attaches any invited records addressed to this person to their account.

    Gated on Supabase having confirmed the address, for the same reason the
    staff path is: without it, signing up with somebody else's invited email
    would hand over their record.

    One login can claim several — a parent's account covers their children.
    Returns how many were claimed. Safe to call repeatedly.
    """
    email = (getattr(user, "email", "") or "").strip()
    if not email or not getattr(user, "email_verified", False):
        return 0

    return Student.objects.filter(
        email__iexact=email, user_id="", invited_at__isnull=False
    ).update(user_id=user.id)


def invite(student):
    """Let this member sign in. Needs an address to invite."""
    if not student.email:
        return False
    if not student.invited_at:
        student.invited_at = timezone.now()
        student.save(update_fields=["invited_at"])
    return True


def withdraw_invite(student):
    """Take the login away. The record and its history stay."""
    student.invited_at = None
    student.user_id = ""
    student.save(update_fields=["invited_at", "user_id"])
