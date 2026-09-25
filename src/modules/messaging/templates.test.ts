import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES, joinNames, LANGUAGES, render, TEMPLATE_KEYS, TEMPLATE_VARIABLES, variablesIn } from "./templates";

describe("render", () => {
  it("fills variables and leaves no gap for an empty one", () => {
    expect(render("Hello {{guardian_name}}, {{student_name}} is absent.", { guardian_name: "Sana", student_name: "Zoya" })).toBe("Hello Sana, Zoya is absent.");
    expect(render("Class cancelled. {{reason}}", {})).toBe("Class cancelled.");
    expect(render("Paid {{amount}} ({{ invoice_number }}).", { amount: "₹800", invoice_number: "INV/2026-27/0001" })).toBe("Paid ₹800 (INV/2026-27/0001).");
  });

  it("every default uses only the variables its template allows", () => {
    for (const key of TEMPLATE_KEYS) {
      for (const lang of LANGUAGES) expect(variablesIn(DEFAULT_TEMPLATES[key][lang]).filter((v) => !TEMPLATE_VARIABLES[key].includes(v)), `${key}/${lang}`).toEqual([]);
    }
    expect(variablesIn("{{amount}} and {{ amount }} {{link}}")).toEqual(["amount", "link"]);
  });
});

describe("joinNames", () => {
  it("reads like a sentence", () => {
    expect(joinNames(["Riya"])).toBe("Riya");
    expect(joinNames(["Riya", "Kabir"])).toBe("Riya and Kabir");
    expect(joinNames(["Riya", "Kabir", "Zoya"])).toBe("Riya, Kabir and Zoya");
  });
});
