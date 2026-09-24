import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { DEV_ENCRYPTION_KEY, getEnv } from "@/lib/env";

// CLAUDE.md rule 9: an academy's Razorpay and WhatsApp secrets are sealed at
// rest with the app key. AES-256-GCM, with the owner (tenant and kind) bound as
// associated data, so a blob copied onto another tenant's row will not open.
// Layout: version (1 byte) | iv (12) | tag (16) | ciphertext. Errors never
// carry the secret.
const VERSION = 1;
const HEAD = 1 + 12 + 16;

// The development key from .env.example never seals a real academy's secrets.
export function keyFrom(base64: string | undefined, nodeEnv = "development"): Buffer {
  if (!base64) throw new Error("APP_ENCRYPTION_KEY is not set; it is needed to store an academy's integration keys");
  if (nodeEnv === "production" && base64 === DEV_ENCRYPTION_KEY) throw new Error("APP_ENCRYPTION_KEY is the development key from .env.example; set a real one for production");
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be 32 bytes, base64");
  return key;
}

const appKey = () => keyFrom(getEnv().APP_ENCRYPTION_KEY, getEnv().NODE_ENV);

// `owner` names whose secret it is, e.g. "tenant:<uuid>:razorpay".
export function seal(plain: string, owner: string, key: Buffer = appKey()): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(owner, "utf8"));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
}

export function open(sealed: Buffer, owner: string, key: Buffer = appKey()): string {
  if (sealed.length < HEAD || sealed[0] !== VERSION) throw new Error("Sealed secret is not readable");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(1, 13));
    decipher.setAAD(Buffer.from(owner, "utf8"));
    decipher.setAuthTag(sealed.subarray(13, HEAD));
    return Buffer.concat([decipher.update(sealed.subarray(HEAD)), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Sealed secret does not open with this key and owner");
  }
}

// A webhook's HMAC-SHA256 signature (hex) over the raw body, compared in
// constant time. Anything malformed is simply not a match.
export function signatureMatches(rawBody: string, secret: string, signatureHex: string | null | undefined): boolean {
  if (!signatureHex || !/^[0-9a-f]{64}$/i.test(signatureHex)) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  return timingSafeEqual(expected, Buffer.from(signatureHex, "hex"));
}
