import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// RFC 6238 codes (RFC 4226 HOTP over 30-second steps) for the platform admin's
// authenticator app (agreed 2026-09-26). No package: it is this small.

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_STEP_SECONDS = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return bits > 0 ? out + B32[(value << (5 - bits)) & 31] : out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Not a base32 key");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// 20 random bytes, as the setup key an authenticator app takes.
export const newTotpSecret = (): string => base32Encode(randomBytes(20));

export function hotp(key: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", key).update(msg).digest();
  const at = (mac[mac.length - 1] ?? 0) & 15;
  const bin = (mac.readUInt32BE(at) & 0x7fffffff) % 10 ** digits;
  return String(bin).padStart(digits, "0");
}

export const totpStep = (at: Date): number => Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS);

export const totp = (secret: string, at: Date = new Date(), digits = 6): string => hotp(base32Decode(secret), totpStep(at), digits);

// The step a code belongs to, allowing one step either side for clock drift;
// undefined when it matches none.
export function totpMatch(secret: string, code: string, at: Date = new Date()): number | undefined {
  if (!/^\d{6}$/.test(code)) return undefined;
  const key = base32Decode(secret);
  const now = totpStep(at);
  for (const step of [now - 1, now, now + 1]) {
    if (timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(code))) return step;
  }
  return undefined;
}

export const otpauthUrl = (secret: string, account: string, issuer = "Bravitar"): string =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_STEP_SECONDS}`;
