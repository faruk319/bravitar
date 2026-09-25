import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES, joinNames, LANGUAGES, render, TEMPLATE_KEYS } from "./templates";

describe("render", () => {
  it("fills variables and leaves no gap for an empty one", () => {
    expect(render("Hello {{guardian_name}}, {{student_name}} is absent.", { guardian_name: "Sana", student_name: "Zoya" })).toBe("Hello Sana, Zoya is absent.");
    expect(render("Class cancelled. {{reason}}", {})).toBe("Class cancelled.");
    expect(render("Paid {{amount}} ({{ invoice_number }}).", { amount: "₹800", invoice_number: "INV/2026-27/0001" })).toBe("Paid ₹800 (INV/2026-27/0001).");
  });

  it("every default uses only the variables its sender provides", () => {
    const provided: Record<string, string[]> = {
      fee_due: ["guardian_name", "student_names", "amount", "academy", "due_date", "invoice_number", "link"],
      fee_overdue: ["guardian_name", "student_names", "amount", "academy", "due_date", "invoice_number", "link"],
      receipt: ["guardian_name", "academy", "amount", "date", "receipt_number", "link"],
      absent: ["guardian_name", "student_name", "batch", "academy", "date"],
      class_cancelled: ["guardian_name", "student_name", "batch", "academy", "date", "time", "reason"],
      welcome: ["academy", "guardian_name", "student_name"],
    };
    for (const key of TEMPLATE_KEYS) {
      for (const lang of LANGUAGES) {
        const used = [...DEFAULT_TEMPLATES[key][lang].matchAll(/\{\{([a-z_]+)\}\}/g)].map((m) => m[1]);
        expect(used.filter((v) => !provided[key]?.includes(v ?? "")), `${key}/${lang}`).toEqual([]);
      }
    }
  });
});

describe("joinNames", () => {
  it("reads like a sentence", () => {
    expect(joinNames(["Riya"])).toBe("Riya");
    expect(joinNames(["Riya", "Kabir"])).toBe("Riya and Kabir");
    expect(joinNames(["Riya", "Kabir", "Zoya"])).toBe("Riya, Kabir and Zoya");
  });
});
