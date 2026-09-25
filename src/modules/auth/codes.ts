import { randomInt } from "node:crypto";
import { sql } from "drizzle-orm";
import { hashToken } from "@/lib/auth/token";
import { db } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { httpWhatsapp, WhatsappError } from "@/modules/integrations/whatsapp";

// 6-digit codes on WhatsApp (docs/01 Auth). The limits live in the database
// functions of migration 0020; the app never reads app.otp_codes itself.
export type CodePurpose = "password_reset" | "portal_login";
export type CodeCheck = "ok" | "wrong" | "locked" | "none";
export type CodeSender = (phone: string, code: string) => Promise<void>;

// Bound to the phone and purpose, so a hash means nothing anywhere else.
const hashCode = (phone: string, purpose: CodePurpose, code: string) => hashToken(`${purpose}:${phone}:${code}`);

// A fresh code, sent; false when the phone is locked or already had 3 codes
// in 15 minutes, or WhatsApp refused it.
export async function sendCode(phone: string, purpose: CodePurpose, send: CodeSender, now = new Date()): Promise<boolean> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const [r] = await db.execute<{ ok: boolean }>(sql`SELECT app.otp_issue(${phone}, ${purpose}, ${hashCode(phone, purpose, code)}, ${now.toISOString()}::timestamptz) AS ok`);
  if (!r?.ok) return false;
  try {
    await send(phone, code);
    return true;
  } catch (e) {
    if (!(e instanceof WhatsappError)) throw e;
    console.error(`code not sent: ${e.message}`);
    return false;
  }
}

export async function checkCode(phone: string, purpose: CodePurpose, code: string, now = new Date()): Promise<CodeCheck> {
  if (!/^\d{6}$/.test(code)) return "wrong";
  const [r] = await db.execute<{ result: CodeCheck }>(sql`SELECT app.otp_check(${phone}, ${purpose}, ${hashCode(phone, purpose, code)}, ${now.toISOString()}::timestamptz) AS result`);
  return r?.result ?? "none";
}

// Bravitar's own number (agreed 2026-09-25) and its English authentication
// template. Without it, development prints the code in the server log;
// production has no sender.
export function platformSender(): CodeSender | undefined {
  const env = getEnv();
  if (env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID && env.PLATFORM_WHATSAPP_ACCESS_TOKEN) {
    const client = httpWhatsapp({ phoneNumberId: env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID, accessToken: env.PLATFORM_WHATSAPP_ACCESS_TOKEN });
    const templateName = env.PLATFORM_WHATSAPP_CODE_TEMPLATE ?? "login_code";
    return async (to, code) => {
      await client.sendCode({ to, templateName, language: "en", code });
    };
  }
  if (env.NODE_ENV === "production") return undefined;
  return async (to, code) => console.info(`dev only: code ${code} for the phone ending ${to.slice(-4)}`);
}
