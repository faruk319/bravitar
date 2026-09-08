import hashlib
import secrets

from django.db import models, transaction
from django.utils import timezone

from .constants import Plan, Role


class Academy(models.Model):
    """A business inside an academy: a gym, a swim school, a dojo.

    The unit everything operational hangs off — members, batches, money — and
    where the sports on offer are chosen. An academy with one academy is
    the common case and never has to think about the distinction.
    """

    name = models.CharField(max_length=255)
    slug = models.SlugField(unique=True)
    plan = models.CharField(max_length=20, choices=Plan.CHOICES, default=Plan.FREE)

    custom_domain = models.CharField(max_length=255, unique=True, null=True, blank=True)
    domain_verified = models.BooleanField(default=False)
    verticals = models.JSONField(default=list, blank=True)

    # Whether a membership only starts admitting the member once money has
    # arrived. On (the default) a fresh unpaid membership reads "pending"
    # rather than "active", so the front desk is never told somebody is a
    # paid-up member when nothing has been collected. Gyms that let regulars
    # settle up later switch this off and get date-only memberships back.
    membership_requires_payment = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name


class Branch(models.Model):
    """One location of an academy. Also the unit of access — who may work
    where is assigned per branch."""

    academy = models.ForeignKey(Academy, on_delete=models.CASCADE, related_name="branches")
    name = models.CharField(max_length=255)
    address = models.CharField(max_length=500, blank=True)
    phone = models.CharField(max_length=32, blank=True)
    email = models.EmailField(blank=True)
    # The branch a new member lands in when nobody picks one. At most one per
    # academy; setting a new one clears the old.
    is_primary = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["academy"],
                condition=models.Q(is_primary=True),
                name="one_primary_branch_per_org",
            )
        ]

    def save(self, *args, **kwargs):
        # Clear the old primary first: the unique constraint rejects the write
        # before any after-the-fact tidying could run.
        with transaction.atomic():
            if self.is_primary:
                others = Branch.objects.filter(
                    academy_id=self.academy_id, is_primary=True
                )
                if self.pk:
                    others = others.exclude(pk=self.pk)
                others.update(is_primary=False)
            super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.academy.name} — {self.name}"


class Membership(models.Model):
    """Links a Supabase-authenticated user to an Academy with a role.

    Users live in Supabase Auth, not Django's auth_user table, so we key on
    the Supabase user id (a UUID string) rather than a Django FK.

    A membership can exist before its person does: an owner invites by email,
    and `user_id` stays empty until that person first signs in and claims it.
    That's why the two uniqueness rules are conditional — several pending
    invites in one academy all share an empty `user_id`.
    """

    academy = models.ForeignKey(Academy, on_delete=models.CASCADE, related_name="memberships")
    user_id = models.CharField(
        max_length=64, blank=True, default="",
        help_text="Supabase user id. Empty until an invited person first signs in.",
    )
    email = models.EmailField()
    role = models.CharField(max_length=20, choices=Role.CHOICES)
    # Which locations this person works in. Empty means none — access is
    # granted, never assumed. Owners ignore this and see every branch.
    branches = models.ManyToManyField(Branch, blank=True, related_name="team")
    created_at = models.DateTimeField(auto_now_add=True)
    joined_at = models.DateTimeField(
        null=True, blank=True, help_text="When the invitation was claimed."
    )

    class Meta:
        ordering = ["email"]
        constraints = [
            models.UniqueConstraint(
                fields=["academy", "user_id"],
                condition=~models.Q(user_id=""),
                name="one_membership_per_user_per_org",
            ),
            models.UniqueConstraint(
                fields=["academy", "email"],
                condition=~models.Q(email=""),
                name="one_membership_per_email_per_org",
            ),
        ]

    def __str__(self):
        return f"{self.email or self.user_id} ({self.role}) @ {self.academy.name}"

    @property
    def is_pending(self):
        return not self.user_id


def _generate_key():
    return f"bvt_{secrets.token_urlsafe(32)}"


def _hash_key(raw_key):
    return hashlib.sha256(raw_key.encode()).hexdigest()


class APIKey(models.Model):
    academy = models.ForeignKey(Academy, on_delete=models.CASCADE, related_name="api_keys")
    name = models.CharField(max_length=255, blank=True)
    prefix = models.CharField(max_length=12, editable=False)
    hashed_key = models.CharField(max_length=64, unique=True, editable=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.prefix}... ({self.academy.name})"

    @classmethod
    def generate(cls, academy, name=""):
        """Create a new key, returning (instance, raw_key). raw_key is only
        ever available here — only its hash is persisted."""
        raw_key = _generate_key()
        instance = cls.objects.create(
            academy=academy,
            name=name,
            prefix=raw_key[:12],
            hashed_key=_hash_key(raw_key),
        )
        return instance, raw_key

    @classmethod
    def resolve(cls, raw_key):
        try:
            api_key = cls.objects.select_related("academy").get(
                hashed_key=_hash_key(raw_key), is_active=True
            )
        except cls.DoesNotExist:
            return None
        api_key.last_used_at = timezone.now()
        api_key.save(update_fields=["last_used_at"])
        return api_key
