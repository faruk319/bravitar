"""Security properties that are easy to regress silently."""

import io

import jwt
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, override_settings
from PIL import Image
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.test import APIRequestFactory

from accounts.authentication import SupabaseJWTAuthentication, SupabaseUser
from organizations.models import APIKey
from rest_framework.test import APIClient

from .base import BASE_DOMAIN, TenantAPITestCase


def a_jpeg():
    buffer = io.BytesIO()
    Image.new("RGB", (10, 10), (0, 0, 255)).save(buffer, format="JPEG")
    return SimpleUploadedFile("p.jpg", buffer.getvalue(), content_type="image/jpeg")


class ProgressPhotoPrivacyTests(TenantAPITestCase):
    """Progress photos are pictures of someone's body. Being in the same
    academy — even as its owner — is not a reason to see them."""

    def upload_as_manager(self):
        return self.client_for(self.manager).post(
            "/api/gym/body/photos/",
            {"image": a_jpeg(), "pose": "front", "taken_on": "2026-01-01"},
            format="multipart",
        )

    def test_owner_uploads_and_reads_their_own(self):
        created = self.upload_as_manager()
        self.assertEqual(created.status_code, 201)

        response = self.client_for(self.manager).get(
            f"/api/gym/body/photos/{created.data['id']}/image/"
        )
        self.assertEqual(response.status_code, 200)

    def test_the_academy_owner_cannot_read_a_members_photo(self):
        created = self.upload_as_manager()
        response = self.client_for(self.owner).get(
            f"/api/gym/body/photos/{created.data['id']}/image/"
        )
        self.assertEqual(response.status_code, 404)

    def test_photos_do_not_appear_in_another_persons_list(self):
        self.upload_as_manager()
        self.assertEqual(
            self.client_for(self.owner).get("/api/gym/body/photos/").data["count"], 0
        )

    def test_anonymous_cannot_read_a_photo(self):
        created = self.upload_as_manager()
        response = self.client_for(None).get(
            f"/api/gym/body/photos/{created.data['id']}/image/"
        )
        self.assertEqual(response.status_code, 403)

    def test_the_url_returned_is_the_guarded_view_not_a_media_path(self):
        created = self.upload_as_manager()
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


class WritePermissionsAreAFloorTests(TenantAPITestCase):
    """A view's declared permissions must survive the request being a write.

    OrganizationScopedMixin used to swap the whole declared set for
    "must be staff" on any non-GET. Every view that asked for something
    stricter — a vertical gate, managers only, a real person rather than an
    API key — quietly got none of it as soon as the request was a POST or PUT.
    These are the writes that were reachable because of it.
    """

    def setUp(self):
        super().setUp()
        from datetime import date

        from students.models import Student

        self.org.verticals = ["gym", "fitness"]
        self.org.save()
        self.student = Student.objects.create(
            academy=self.org, full_name="Walk In", joined_on=date(2026, 1, 1)
        )
        _, self.raw_key = APIKey.generate(self.org.organization, name="their app")

    def as_key(self):
        client = APIClient(HTTP_HOST=f"{self.org.slug}.{BASE_DOMAIN}")
        client.credentials(HTTP_X_API_KEY=self.raw_key)
        return client

    def assertRefused(self, response):
        self.assertIn(
            response.status_code, (401, 403),
            f"an API key completed a write reserved for people — got {response.status_code}",
        )

    def test_an_api_key_cannot_upload_a_member_photo(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        self.assertRefused(self.as_key().put(
            f"/api/students/{self.student.id}/photo/",
            {"photo": SimpleUploadedFile("f.jpg", b"\xff\xd8\xff\xe0", "image/jpeg")},
            format="multipart",
        ))

    def test_an_api_key_cannot_delete_a_member_photo(self):
        self.assertRefused(
            self.as_key().delete(f"/api/students/{self.student.id}/photo/")
        )

    def test_an_api_key_cannot_file_an_id_scan(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        self.assertRefused(self.as_key().post(
            "/api/students/documents/",
            {
                "student": self.student.id, "kind": "aadhaar",
                "file": SimpleUploadedFile("f.jpg", b"\xff\xd8\xff\xe0", "image/jpeg"),
            },
            format="multipart",
        ))

    def test_an_api_key_cannot_check_a_member_in_through_the_desk(self):
        """The scanner endpoint is the door's way in; the desk endpoint names
        members and is not."""
        self.assertRefused(self.as_key().post(
            "/api/attendance/checkins/", {"student": self.student.id}, format="json"
        ))

    def test_a_write_still_needs_its_vertical(self):
        """Body measurements are behind the fitness module; a POST must not
        walk past that gate just because it is a write."""
        self.org.verticals = ["gym"]
        self.org.save()
        response = self.client_for(self.manager).post(
            "/api/gym/body/entries/",
            {"metric": "weight", "value": "80", "unit": "kg", "measured_on": "2026-01-01"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
