import { createHash, randomBytes } from "node:crypto";

// Opaque tokens (session cookies, invite links): the client holds the token, the database only its hash.
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
