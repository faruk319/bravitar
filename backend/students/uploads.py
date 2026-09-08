"""Checks every onboarding upload has to pass.

Two things are being defended against. An unbounded upload is how one tenant
fills the disk for every other tenant; and a content type nobody checked is
how a file called "aadhaar.jpg" turns out to be something else entirely once
it is sitting on the server.

The type is decided by looking at the bytes, not by trusting the browser's
Content-Type header or the file's extension — both are attacker-controlled.
"""

from rest_framework import serializers

from .constants import Upload

# Leading bytes that identify the formats we accept. A file whose first bytes
# match none of these is rejected whatever it claims to be.
SIGNATURES = [
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"%PDF-", "application/pdf"),
]


def _sniff(upload):
    head = upload.read(32)
    upload.seek(0)

    for signature, content_type in SIGNATURES:
        if head.startswith(signature):
            return content_type
    # WEBP is RIFF....WEBP — the size sits between the two markers.
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


def _human(size):
    return f"{size / (1024 * 1024):.0f}MB"


def validate_upload(upload, *, allowed_types, max_bytes, what):
    """Return the real content type, or raise a ValidationError saying why not."""
    if upload.size > max_bytes:
        raise serializers.ValidationError(
            f"That {what} is {_human(upload.size)}. The limit is {_human(max_bytes)} — "
            "take the photo again at a smaller size."
        )
    if upload.size == 0:
        raise serializers.ValidationError(f"That {what} is empty.")

    content_type = _sniff(upload)
    if content_type not in allowed_types:
        readable = ", ".join(t.rsplit("/", 1)[-1].upper() for t in allowed_types)
        raise serializers.ValidationError(
            f"That file isn't one we can accept as a {what}. Use {readable}."
        )
    return content_type


def validate_photo(upload):
    return validate_upload(
        upload,
        allowed_types=Upload.PHOTO_TYPES,
        max_bytes=Upload.MAX_PHOTO_BYTES,
        what="photo",
    )


def validate_document(upload):
    return validate_upload(
        upload,
        allowed_types=Upload.DOCUMENT_TYPES,
        max_bytes=Upload.MAX_DOCUMENT_BYTES,
        what="document",
    )
