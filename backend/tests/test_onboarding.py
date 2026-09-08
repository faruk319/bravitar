"""Digital onboarding — a member's photo and their proof of identity.

These are the most sensitive records the product holds. A progress photo is
private to the member; an Aadhaar scan is worse, because it is useful to a
thief. So the rules here are tighter than anywhere else, and these tests exist
to keep them tight: managers only, no API keys, no static serving, no full
document numbers, and nothing crossing a tenant boundary.
"""

import io
from datetime import date

from django.core.files.uploadedfile import SimpleUploadedFile

from organizations.models import APIKey, Academy
from students.models import MemberDocument, Student

from .base import TenantAPITestCase

def _image(fmt):
    """A real image. A hand-made byte string with the right magic number is
    not enough — an ImageField decodes what it is given, so the fixtures have
    to be decodable."""
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), (120, 40, 40)).save(buffer, format=fmt)
    return buffer.getvalue()


JPEG = _image("JPEG")
PNG = _image("PNG")
PDF = b"%PDF-1.4\n" + b"\x00" * 64


def upload(name, content, content_type="image/jpeg"):
    return SimpleUploadedFile(name, content, content_type=content_type)


class OnboardingTestCase(TenantAPITestCase):
    def setUp(self):
        super().setUp()
        self.student = Student.objects.create(
            academy=self.org, full_name="New Joiner", joined_on=date(2026, 1, 1)
        )

    def put_photo(self, actor=None, content=JPEG, name="face.jpg"):
        return self.client_for(actor or self.manager).put(
            f"/api/students/{self.student.id}/photo/",
            {"photo": upload(name, content)},
            format="multipart",
        )

    def api_key_client(self):
        from rest_framework.test import APIClient

        from .base import BASE_DOMAIN

        _, raw = APIKey.generate(self.org.organization, name="their app")
        client = APIClient(HTTP_HOST=f"{self.org.slug}.{BASE_DOMAIN}")
        client.credentials(HTTP_X_API_KEY=raw)
        return client

    def post_document(self, actor=None, **overrides):
        payload = {
            "student": self.student.id,
            "kind": "aadhaar",
            "number_last4": "4321",
            "file": upload("aadhaar.jpg", JPEG),
        }
        payload.update(overrides)
        return self.client_for(actor or self.manager).post(
            "/api/students/documents/", payload, format="multipart"
        )


class MemberPhotoTests(OnboardingTestCase):
    def test_a_photo_can_be_uploaded_and_read_back(self):
        self.assertEqual(self.put_photo().status_code, 200)

        response = self.client_for(self.manager).get(
            f"/api/students/{self.student.id}/photo/"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(b"".join(response.streaming_content), JPEG)

    def test_the_member_list_says_who_has_a_photo_without_sending_it(self):
        self.put_photo()
        row = self.client_for(self.manager).get("/api/students/").data["results"][0]
        self.assertTrue(row["has_photo"])
        self.assertNotIn("photo", row)

    def test_the_photo_is_open_to_everyone_running_the_academy(self):
        """The desk has to match the face to the name, so this is deliberately
        wider than the ID scans — owners and managers both, and coaches too
        once the staff role is switched on for sign-in."""
        self.put_photo()
        for actor in (self.owner, self.manager):
            self.assertEqual(
                self.client_for(actor).get(
                    f"/api/students/{self.student.id}/photo/"
                ).status_code,
                200,
            )

    def test_an_api_key_cannot_read_a_photo(self):
        self.put_photo()
        response = self.api_key_client().get(f"/api/students/{self.student.id}/photo/")
        self.assertIn(response.status_code, (401, 403))

    def test_another_tenant_cannot_read_a_photo(self):
        """A signed-in owner of a different academy, asking for our member's
        id. Must be a miss, not a picture."""
        self.put_photo()
        response = self.client_for(self.other_owner, academy=self.other_org).get(
            f"/api/students/{self.student.id}/photo/"
        )
        self.assertIn(response.status_code, (403, 404))

    def test_a_missing_photo_is_a_404_not_a_crash(self):
        response = self.client_for(self.manager).get(
            f"/api/students/{self.student.id}/photo/"
        )
        self.assertEqual(response.status_code, 404)

    def test_removing_a_photo_takes_it_off_the_record(self):
        self.put_photo()
        self.assertEqual(
            self.client_for(self.manager).delete(
                f"/api/students/{self.student.id}/photo/"
            ).status_code,
            204,
        )
        self.student.refresh_from_db()
        self.assertFalse(self.student.photo)


class UploadValidationTests(OnboardingTestCase):
    def test_a_file_that_is_not_an_image_is_refused(self):
        """The extension and the browser's content type are both attacker
        controlled; only the bytes decide."""
        response = self.put_photo(content=b"#!/bin/sh\nrm -rf /\n", name="face.jpg")
        self.assertEqual(response.status_code, 400)

    def test_a_pdf_is_not_a_photo(self):
        self.assertEqual(self.put_photo(content=PDF, name="scan.jpg").status_code, 400)

    def test_a_pdf_is_a_valid_document(self):
        response = self.post_document(file=upload("id.pdf", PDF, "application/pdf"))
        self.assertEqual(response.status_code, 201)

    def test_an_oversized_photo_is_refused(self):
        """Rejected on size alone, without decoding — which is the point:
        a 40MB upload must not be decoded before being turned away."""
        big = JPEG + b"\x00" * (5 * 1024 * 1024)
        response = self.put_photo(content=big)
        self.assertEqual(response.status_code, 400)
        self.assertIn("limit", str(response.data).lower())

    def test_an_empty_file_is_refused(self):
        response = self.put_photo(content=b"")
        self.assertEqual(response.status_code, 400)


class MemberDocumentTests(OnboardingTestCase):
    def test_a_document_can_be_filed_against_a_member(self):
        response = self.post_document()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["kind_label"], "Aadhaar")
        self.assertFalse(response.data["is_verified"])

    def test_listing_documents_never_includes_the_file(self):
        self.post_document()
        row = self.client_for(self.manager).get(
            f"/api/students/documents/?student={self.student.id}"
        ).data["results"][0]
        self.assertNotIn("file", row)

    def test_the_full_document_number_cannot_be_stored(self):
        """A whole Aadhaar number is a liability with no feature behind it."""
        response = self.post_document(number_last4="123412341234")
        self.assertEqual(response.status_code, 400)
        self.assertIn("last four", str(response.data).lower())

    def test_the_same_proof_is_not_filed_twice(self):
        self.post_document()
        again = self.post_document(file=upload("aadhaar2.jpg", JPEG))
        self.assertEqual(again.status_code, 400)

    def test_a_second_kind_of_proof_is_fine(self):
        self.post_document()
        response = self.post_document(
            kind="pan", number_last4="", file=upload("pan.jpg", JPEG)
        )
        self.assertEqual(response.status_code, 201)

    def test_verifying_records_who_checked_and_when(self):
        created = self.post_document()
        response = self.client_for(self.manager).post(
            f"/api/students/documents/{created.data['id']}/verify/"
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["is_verified"])
        self.assertTrue(response.data["verified_on"])

    def test_the_scan_can_be_downloaded_by_a_manager(self):
        created = self.post_document()
        response = self.client_for(self.manager).get(
            f"/api/students/documents/{created.data['id']}/file/"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(b"".join(response.streaming_content), JPEG)


class DocumentPrivacyTests(OnboardingTestCase):
    """Who may not see an ID scan. Each of these is a leak if it flips."""

    def setUp(self):
        super().setUp()
        self.document = MemberDocument.objects.create(
            academy=self.org, student=self.student, kind="aadhaar",
            file=upload("aadhaar.jpg", JPEG), number_last4="4321",
        )

    def assertClosed(self, response):
        self.assertIn(
            response.status_code, (401, 403, 404),
            f"an ID scan was reachable — got {response.status_code}",
        )

    def test_a_coach_cannot_list_id_scans(self):
        self.assertClosed(self.client_for(self.staff).get("/api/students/documents/"))

    def test_a_coach_cannot_download_an_id_scan(self):
        self.assertClosed(
            self.client_for(self.staff).get(
                f"/api/students/documents/{self.document.id}/file/"
            )
        )

    def test_a_coach_cannot_upload_an_id_scan(self):
        self.assertClosed(self.post_document(actor=self.staff))

    def test_a_coach_cannot_verify_an_id_scan(self):
        self.assertClosed(
            self.client_for(self.staff).post(
                f"/api/students/documents/{self.document.id}/verify/"
            )
        )

    def test_an_api_key_cannot_touch_id_scans(self):
        client = self.api_key_client()
        self.assertClosed(client.get("/api/students/documents/"))
        self.assertClosed(
            client.get(f"/api/students/documents/{self.document.id}/file/")
        )

    def test_another_tenant_cannot_download_an_id_scan(self):
        self.assertClosed(
            self.client_for(self.other_owner, academy=self.other_org).get(
                f"/api/students/documents/{self.document.id}/file/"
            )
        )

    def test_a_document_cannot_be_filed_against_another_tenants_member(self):
        outsider = Student.objects.create(
            academy=self.other_org, full_name="Not Ours", joined_on=date(2026, 1, 1)
        )
        response = self.post_document(
            student=outsider.id, file=upload("x.jpg", JPEG)
        )
        self.assertEqual(response.status_code, 400)


class MemberDeletionTests(OnboardingTestCase):
    """Deleting a member is allowed, until money is involved."""

    def test_a_member_with_no_history_can_be_deleted(self):
        response = self.client_for(self.manager).delete(
            f"/api/students/{self.student.id}/"
        )
        self.assertEqual(response.status_code, 204)
        self.assertFalse(Student.objects.filter(pk=self.student.id).exists())

    def test_deleting_takes_the_id_scans_with_it(self):
        self.post_document()
        self.client_for(self.manager).delete(f"/api/students/{self.student.id}/")
        self.assertEqual(MemberDocument.objects.filter(student=self.student).count(), 0)

    def test_a_member_who_has_been_invoiced_cannot_be_deleted(self):
        """Invoices PROTECT their member. Without this the delete comes back
        as a 500 instead of an explanation."""
        from datetime import date as date_type
        from decimal import Decimal

        from billing.models import Invoice

        Invoice.objects.create(
            academy=self.org, student=self.student, amount=Decimal("1500.00"),
            issued_on=date_type(2026, 1, 1), due_on=date_type(2026, 1, 1),
        )

        response = self.client_for(self.manager).delete(
            f"/api/students/{self.student.id}/"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("left", str(response.data).lower())
        self.assertTrue(Student.objects.filter(pk=self.student.id).exists())
