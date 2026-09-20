import { z } from "zod";

// docs/02-data-model.md "Label packs". The canonical entity names never change
// in code or database; only what the screen calls them does.
export const VERTICAL_PRESETS = ["general", "tuition", "deeniyat", "karate", "dance", "sports"] as const;
export type VerticalPreset = (typeof VERTICAL_PRESETS)[number];

export const LABEL_KEYS = ["student", "staff", "batch", "session", "program"] as const;
export type LabelKey = (typeof LABEL_KEYS)[number];

export type Label = { one: string; many: string };
export type LabelPack = Record<LabelKey, Label>;

const l = (one: string, many = `${one}s`): Label => ({ one, many });

export const LABEL_PRESETS: Record<VerticalPreset, LabelPack> = {
  general: { student: l("Student"), staff: l("Staff", "Staff"), batch: l("Batch", "Batches"), session: l("Session"), program: l("Program") },
  tuition: { student: l("Student"), staff: l("Teacher"), batch: l("Batch", "Batches"), session: l("Class", "Classes"), program: l("Subject") },
  deeniyat: { student: l("Student"), staff: l("Teacher"), batch: l("Batch", "Batches"), session: l("Class", "Classes"), program: l("Course") },
  karate: { student: l("Student"), staff: l("Coach", "Coaches"), batch: l("Batch", "Batches"), session: l("Class", "Classes"), program: l("Program") },
  dance: { student: l("Student"), staff: l("Instructor"), batch: l("Batch", "Batches"), session: l("Class", "Classes"), program: l("Course") },
  sports: { student: l("Player"), staff: l("Coach", "Coaches"), batch: l("Group"), session: l("Session"), program: l("Program") },
};

const labelText = z.string().trim().min(1).max(40);

// Shape of tenants.label_overrides. Partial per key; unknown keys are dropped.
export const labelOverridesSchema = z.object(
  Object.fromEntries(LABEL_KEYS.map((k) => [k, z.object({ one: labelText.optional(), many: labelText.optional() }).optional()])),
);
export type LabelOverrides = z.infer<typeof labelOverridesSchema>;

export function isVerticalPreset(value: string): value is VerticalPreset {
  return (VERTICAL_PRESETS as readonly string[]).includes(value);
}

export function resolveLabels(tenant: { verticalPreset: string; labelOverrides: unknown }): LabelPack {
  const preset = LABEL_PRESETS[isVerticalPreset(tenant.verticalPreset) ? tenant.verticalPreset : "general"];
  const parsed = labelOverridesSchema.safeParse(tenant.labelOverrides ?? {});
  const overrides: LabelOverrides = parsed.success ? parsed.data : {};
  const pack = {} as LabelPack;
  for (const key of LABEL_KEYS) {
    const o = overrides[key];
    pack[key] = { one: o?.one ?? preset[key].one, many: o?.many ?? preset[key].many };
  }
  return pack;
}
