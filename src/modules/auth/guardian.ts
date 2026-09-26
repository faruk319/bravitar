import { z } from "zod";
import { withTenant } from "@/lib/db/with-tenant";
import { AppError, BadRequestError, TooManyRequestsError } from "@/lib/errors";
import { phoneSchema } from "@/lib/phone";
import { findGuardianByPhone } from "@/modules/students/repo";
import { checkCode, type CodeSender, platformSender, sendCode } from "./codes";
import { guardianAcademiesByPhone, type StaffAcademy } from "./repo";
import { type Academy, handoffTo, type Meta, openGuardianSession } from "./service";

// Parents and adult students sign in with a WhatsApp code (docs/01 Auth,
// Prompt 20). On an academy's address, that academy; on the main site, every
// academy with this number. No answer shows whether a number is registered.

export const phoneCodeSchema = z.object({ phone: phoneSchema });
export const phoneSignInSchema = z.object({ phone: phoneSchema, code: z.string().trim().max(12) });

async function academiesFor(phone: string, slug: string | undefined): Promise<StaffAcademy[]> {
  const all = await guardianAcademiesByPhone(phone);
  return slug ? all.filter((a) => a.slug === slug) : all;
}

export async function requestPortalCode(input: z.input<typeof phoneCodeSchema>, opts: { slug?: string | undefined; send?: CodeSender; now?: Date } = {}): Promise<void> {
  const { phone } = phoneCodeSchema.parse(input);
  const send = opts.send ?? platformSender();
  if (!send) throw new AppError("Codes can't be sent yet. Ask your academy.", 503);
  if ((await academiesFor(phone, opts.slug)).length) await sendCode(phone, "portal_login", send, opts.now);
}

export type PhoneSignIn = { token: string } | { academies: Academy[] };

// The code proves the phone: on an academy's address it signs in there; on
// the main site each academy with this number gets its one-time pass.
export async function verifyPortalCode(input: z.input<typeof phoneSignInSchema>, opts: { slug?: string | undefined; meta?: Meta; now?: Date } = {}): Promise<PhoneSignIn> {
  const { phone, code } = phoneSignInSchema.parse(input);
  const now = opts.now ?? new Date();
  const academies = await academiesFor(phone, opts.slug);
  const result = academies.length ? await checkCode(phone, "portal_login", code, now) : "none";
  if (result === "locked") throw new TooManyRequestsError("Too many wrong tries. Try again in an hour.");
  if (result !== "ok") throw new BadRequestError("Wrong or expired code");
  const signed = await Promise.all(academies.map(async (a) => ({ a, guardian: await withTenant(a.tenantId, (tx) => findGuardianByPhone(tx, phone)) })));
  const [here] = signed;
  if (opts.slug && here?.guardian) {
    const id = here.guardian.id;
    return { token: (await withTenant(here.a.tenantId, (tx) => openGuardianSession(tx, id, phone, opts.meta ?? {}))).token };
  }
  return { academies: await Promise.all(signed.flatMap(({ a, guardian }) => (guardian ? [handoffTo(a, { guardianId: guardian.id }, now)] : []))) };
}
