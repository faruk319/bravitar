import hashlib
import secrets

from django.db import models
from django.utils import timezone

from .constants import Plan, Role


class Organization(models.Model):
    name = models.CharField(max_length=255)
    slug = models.SlugField(unique=True)
    verticals = models.JSONField(default=list, blank=True)
    plan = models.CharField(max_length=20, choices=Plan.CHOICES, default=Plan.FREE)

    custom_domain = models.CharField(max_length=255, unique=True, null=True, blank=True)
    domain_verified = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name


class Branch(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="branches")
    name = models.CharField(max_length=255)
    address = models.CharField(max_length=500, blank=True)
    is_primary = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name", "id"]

    def __str__(self):
        return f"{self.organization.name} — {self.name}"


class Membership(models.Model):
    """Links a Supabase-authenticated user to an Organization with a role.

    Users live in Supabase Auth, not Django's auth_user table, so we key on
    the Supabase user id (a UUID string) rather than a Django FK.

    A membership can exist before its person does: an owner invites by email,
    and `user_id` stays empty until that person first signs in and claims it.
    That's why the two uniqueness rules are conditional — several pending
    invites in one organization all share an empty `user_id`.
    """

    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="memberships")
    user_id = models.CharField(
        max_length=64, blank=True, default="",
        help_text="Supabase user id. Empty until an invited person first signs in.",
    )
    email = models.EmailField()
    role = models.CharField(max_length=20, choices=Role.CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)
    joined_at = models.DateTimeField(
        null=True, blank=True, help_text="When the invitation was claimed."
    )

    class Meta:
        ordering = ["email"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "user_id"],
                condition=~models.Q(user_id=""),
                name="one_membership_per_user_per_org",
            ),
            models.UniqueConstraint(
                fields=["organization", "email"],
                condition=~models.Q(email=""),
                name="one_membership_per_email_per_org",
            ),
        ]

    def __str__(self):
        return f"{self.email or self.user_id} ({self.role}) @ {self.organization.name}"

    @property
    def is_pending(self):
        return not self.user_id


def _generate_key():
    return f"bvt_{secrets.token_urlsafe(32)}"


def _hash_key(raw_key):
    return hashlib.sha256(raw_key.encode()).hexdigest()


class APIKey(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="api_keys")
    name = models.CharField(max_length=255, blank=True)
    prefix = models.CharField(max_length=12, editable=False)
    hashed_key = models.CharField(max_length=64, unique=True, editable=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.prefix}... ({self.organization.name})"

    @classmethod
    def generate(cls, organization, name=""):
        """Create a new key, returning (instance, raw_key). raw_key is only
        ever available here — only its hash is persisted."""
        raw_key = _generate_key()
        instance = cls.objects.create(
            organization=organization,
            name=name,
            prefix=raw_key[:12],
            hashed_key=_hash_key(raw_key),
        )
        return instance, raw_key

    @classmethod
    def resolve(cls, raw_key):
        try:
            api_key = cls.objects.select_related("organization").get(
                hashed_key=_hash_key(raw_key), is_active=True
            )
        except cls.DoesNotExist:
            return None
        api_key.last_used_at = timezone.now()
        api_key.save(update_fields=["last_used_at"])
        return api_key
