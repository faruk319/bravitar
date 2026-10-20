import { z } from "zod";

// One charge added by hand (finance spec, "Create invoice"), for Create invoice and the collect drawer.
// No service imports: payments and fees import each other, and both build their schemas from this.
export const manualLine = z.object({
  kind: z.enum(["admission", "exam", "item", "other"]),
  description: z.string().trim().min(1, "Say what the charge is for").max(120),
  // Paise arrive as a digit string (JSON has no bigint).
  amountPaise: z
    .string()
    .regex(/^\d{1,13}$/, "Enter an amount")
    .transform((s) => BigInt(s))
    .refine((p) => p > 0n, "Enter an amount"),
  enrollmentId: z.uuid().optional(), // the program it belongs to, so reports can attribute it
  taxRateBp: z.number().int().min(0).max(10_000).optional(),
});
export type ManualLine = z.output<typeof manualLine>;
