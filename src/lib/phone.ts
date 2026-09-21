import { z } from "zod";

// Indian numbers in, E.164 out: "98765 43210", "098765...", "+91 98765...",
// "0091..." all become +919876543210. Anything else is refused plainly.
export function normalizePhone(raw: string): string | undefined {
  const digits = raw.replace(/[^\d+]/g, "");
  let n = digits.startsWith("+") ? digits.slice(1) : digits;
  if (n.startsWith("00")) n = n.slice(2);
  if (n.length === 11 && n.startsWith("0")) n = n.slice(1);
  if (n.length === 12 && n.startsWith("91")) n = n.slice(2);
  if (!/^[6-9]\d{9}$/.test(n)) return undefined;
  return `+91${n}`;
}

export const phoneSchema = z.string().transform((v, ctx) => {
  const normalized = normalizePhone(v);
  if (!normalized) {
    ctx.addIssue({ code: "custom", message: "Enter a 10-digit Indian mobile number" });
    return z.NEVER;
  }
  return normalized;
});

export function formatPhone(e164: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}
