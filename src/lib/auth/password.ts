import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";
import { PASSWORD_UNSET } from "@/modules/staff/schema";

// argon2id with the library's OWASP defaults (m=19 MiB, t=2, p=1).
export const passwordSchema = z.string().min(8, "at least 8 characters").max(128);

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

// Anything that is not an argon2 hash (the "!" sentinel included) never verifies.
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  if (storedHash === PASSWORD_UNSET || !storedHash.startsWith("$argon2")) return false;
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}

// Verified against when the email is unknown, so timing does not reveal accounts.
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hash("dummy-password-for-constant-time");
  return dummyHash;
}
