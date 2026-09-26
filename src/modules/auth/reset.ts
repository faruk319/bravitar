import { z } from "zod";
import { hashPassword, passwordSchema } from "@/lib/auth/password";
import { writeAudit } from "@/lib/db/audit";
import { withTenant } from "@/lib/db/with-tenant";
import { AppError, BadRequestError } from "@/lib/errors";
import { normalizePhone } from "@/lib/phone";
import { resolveTenantBySlug } from "@/lib/tenant/resolve";
import { updateStaffPassword } from "@/modules/staff/repo";
import { checkCode, type CodeSender, platformSender, sendCode } from "./codes";
import { findActiveStaffByEmail, revokeSessionsForStaff, type StaffAcademy, staffAcademiesByEmail } from "./repo";
import { type Academy, handoffTo, type Meta, type OpenedSession, openSession } from "./service";

// Forgot password by a WhatsApp code (agreed 2026-09-25). On an academy's own
// address it covers that academy; on the main site, every academy with this
// email. Every answer reads the same, so no page shows whether an email exists.

type Account = { academy: StaffAcademy; staffId: string; phone: string };

async function accountsWithPhone(email: string, slug: string | undefined): Promise<Account[]> {
  const here = slug ? await resolveTenantBySlug(slug) : undefined;
  const academies = slug ? (here?.status === "active" ? [{ tenantId: here.id, slug: here.slug, name: here.name }] : []) : await staffAcademiesByEmail(email);
  const out: Account[] = [];
  for (const academy of academies) {
    const staff = await withTenant(academy.tenantId, (tx) => findActiveStaffByEmail(tx, email));
    const phone = staff?.phone ? normalizePhone(staff.phone) : undefined;
    if (staff && phone) out.push({ academy, staffId: staff.id, phone });
  }
  return out;
}

export const resetRequestSchema = z.object({ email: z.email().trim().toLowerCase() });

// One code per phone on those accounts; nothing for an account without one.
export async function requestReset(input: z.input<typeof resetRequestSchema>, opts: { slug?: string | undefined; send?: CodeSender; now?: Date } = {}): Promise<void> {
  const { email } = resetRequestSchema.parse(input);
  const send = opts.send ?? platformSender();
  if (!send) throw new AppError("Codes can't be sent yet. Ask your academy owner for a new link.", 503);
  for (const phone of new Set((await accountsWithPhone(email, opts.slug)).map((a) => a.phone))) await sendCode(phone, "password_reset", send, opts.now);
}

export const resetSchema = z.object({ email: z.email().trim().toLowerCase(), code: z.string().trim().max(12), password: passwordSchema });
export type ResetDone = { session: OpenedSession } | { academies: Academy[] };

const WRONG_CODE = "Wrong or expired code. After 5 wrong tries, wait an hour.";

// The code proves the phone: each account with this email and that phone gets
// the new password, its sessions end, and it is audited. Then it signs in: on
// an academy's address straight away, on the main site through its pass.
export async function resetPassword(input: z.input<typeof resetSchema>, opts: { slug?: string | undefined; meta?: Meta; now?: Date } = {}): Promise<ResetDone> {
  const data = resetSchema.parse(input);
  const now = opts.now ?? new Date();
  const accounts = await accountsWithPhone(data.email, opts.slug);
  const proven = new Set<string>();
  for (const phone of new Set(accounts.map((a) => a.phone))) if ((await checkCode(phone, "password_reset", data.code, now)) === "ok") proven.add(phone);
  const reset = accounts.filter((a) => proven.has(a.phone));
  if (!reset.length) throw new BadRequestError(WRONG_CODE);
  const hash = await hashPassword(data.password);
  for (const a of reset) {
    await withTenant(a.academy.tenantId, async (tx) => {
      await updateStaffPassword(tx, a.staffId, hash);
      await revokeSessionsForStaff(tx, a.staffId);
      await writeAudit(tx, { actorType: "staff", actorId: a.staffId, tenantId: a.academy.tenantId, action: "staff.password.reset", entityType: "staff_user", entityId: a.staffId });
    });
  }
  const [first] = reset;
  if (opts.slug && first) return { session: await withTenant(first.academy.tenantId, (tx) => openSession(tx, first.academy.tenantId, first.staffId, opts.meta ?? {}, "password reset")) };
  return { academies: await Promise.all(reset.map((a) => handoffTo(a.academy, { staffId: a.staffId }, now))) };
}
