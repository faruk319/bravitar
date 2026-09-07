"""Security properties that are easy to regress silently."""

import io

import jwt
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, override_settings
from PIL import Image
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.test import APIRequestFactory

from accounts.authentication import SupabaseJWTAuthentication, SupabaseUser

from .base import TenantAPITestCase


def a_jpeg():
    buffer = io.BytesIO()
    Image.new("RGB", (10, 10), (0, 0, 255)).save(buffer, format="JPEG")
    return SimpleUploadedFile("p.jpg", buffer.getvalue(), content_type="image/jpeg")


class ProgressPhotoPrivacyTests(TenantAPITestCase):
    """Progress photos are pictures of someone's body. Being in the same
    academy — even as its owner — is not a reason to see them."""

    def upload_as_staff(self):
        return self.client_for(self.staff).post(
            "/api/gym/body/photos/",
            {"image": a_jpeg(), "pose": "front", "taken_on": "2026-01-01"},
            format="multipart",
        )

    def test_owner_uploads_and_reads_their_own(self):
        created = self.upload_as_staff()
        self.assertEqual(created.status_code, 201)

        response = self.client_for(self.staff).get(
            f"/api/gym/body/photos/{created.data['id']}/image/"
        )
        self.assertEqual(response.status_code, 200)

    def test_the_academy_owner_cannot_read_a_members_photo(self):
        created = self.upload_as_staff()
        response = self.client_for(self.owner).get(
            f"/api/gym/body/photos/{created.data['id']}/image/"
        )
        self.assertEqual(response.status_code, 404)

    def test_photos_do_not_appear_in_another_persons_list(self):
        self.upload_as_staff()
        self.assertEqual(
            self.client_for(self.owner).get("/api/gym/body/photos/").data["count"], 0
        )

    def test_anonymous_cannot_read_a_photo(self):
        created = self.upload_as_staff()
        response = self.client_for(None).get(
            f"/api/gym/body/photos/{created.data['id']}/image/"
        )
        self.assertEqual(response.status_code, 403)

    def test_the_url_returned_is_the_guarded_view_not_a_media_path(self):
        created = self.upload_as_staff()
        self.assertTrue(created.data["image_url"].endswith("/image/"))
        self.assertNotIn("/media/", created.data["image_url"])


class JWTVerificationTests(SimpleTestCase):
    """The auth class must reject anything it cannot verify, rather than
    trusting claims in an unsigned or wrongly-signed token."""

    def setUp(self):
        self.auth = SupabaseJWTAuthentication()
        self.factory = APIRequestFactory()

    def _request_with(self, token):
        return self.factory.get("/", HTTP_AUTHORIZATION=f"Bearer {token}")

    @override_settings(SUPABASE_JWT_SECRET="a-test-secret-of-reasonable-length")
    def test_token_signed_with_the_wrong_secret_is_rejected(self):
        forged = jwt.encode(
            {"sub": "attacker", "email": "a@b.c", "aud": "authenticated"},
            "not-the-real-secret", algorithm="HS256",
        )
        with self.assertRaises(AuthenticationFailed):
            self.auth.authenticate(self._request_with(forged))

    @override_settings(SUPABASE_JWT_SECRET="a-test-secret-of-reasonable-length")
    def test_token_with_the_wrong_audience_is_rejected(self):
        wrong_audience = jwt.encode(
            {"sub": "u", "email": "a@b.c", "aud": "something-else"},
            "a-test-secret-of-reasonable-length", algorithm="HS256",
        )
        with self.assertRaises(AuthenticationFailed):
            self.auth.authenticate(self._request_with(wrong_audience))

    def test_garbage_is_rejected(self):
        with self.assertRaises(AuthenticationFailed):
            self.auth.authenticate(self._request_with("not-a-jwt"))

    @override_settings(SUPABASE_JWT_SECRET="")
    def test_hs256_without_a_configured_secret_is_rejected(self):
        token = jwt.encode({"sub": "u", "aud": "authenticated"}, "x", algorithm="HS256")
        with self.assertRaises(AuthenticationFailed):
            self.auth.authenticate(self._request_with(token))


class SupabaseUserTests(SimpleTestCase):
    def test_email_verified_is_read_from_either_claim_location(self):
        self.assertTrue(SupabaseUser({"email_verified": True}).email_verified)
        self.assertTrue(
            SupabaseUser({"user_metadata": {"email_verified": True}}).email_verified
        )
        self.assertFalse(SupabaseUser({}).email_verified)

    def test_pk_is_the_supabase_id(self):
        """DRF's throttling keys its bucket on user.pk; without this every
        authenticated request 500s."""
        self.assertEqual(SupabaseUser({"sub": "abc"}).pk, "abc")
