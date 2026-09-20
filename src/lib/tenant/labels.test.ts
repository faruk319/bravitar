import { describe, expect, it } from "vitest";
import { LABEL_KEYS, LABEL_PRESETS, VERTICAL_PRESETS, resolveLabels } from "./labels";

describe("LABEL_PRESETS", () => {
  it("defines every key for every preset, with singular and plural", () => {
    for (const preset of VERTICAL_PRESETS) {
      for (const key of LABEL_KEYS) {
        const label = LABEL_PRESETS[preset][key];
        expect(label.one.length, `${preset}.${key}.one`).toBeGreaterThan(0);
        expect(label.many.length, `${preset}.${key}.many`).toBeGreaterThan(0);
      }
    }
  });
});

describe("resolveLabels", () => {
  it("returns the preset when there are no overrides", () => {
    const labels = resolveLabels({ verticalPreset: "karate", labelOverrides: {} });
    expect(labels.staff).toEqual({ one: "Coach", many: "Coaches" });
    expect(labels.session).toEqual({ one: "Class", many: "Classes" });
    expect(labels.student.one).toBe("Student");
  });

  it("merges partial overrides on top of the preset", () => {
    const labels = resolveLabels({ verticalPreset: "karate", labelOverrides: { staff: { one: "Sensei" }, student: { many: "Karatekas" } } });
    expect(labels.staff).toEqual({ one: "Sensei", many: "Coaches" });
    expect(labels.student).toEqual({ one: "Student", many: "Karatekas" });
    expect(labels.batch).toEqual(LABEL_PRESETS.karate.batch);
  });

  it("ignores unknown keys and malformed overrides", () => {
    const labels = resolveLabels({ verticalPreset: "tuition", labelOverrides: { invoice: { one: "Bill" }, staff: "Sir" } });
    expect(labels).toEqual(LABEL_PRESETS.tuition);
  });

  it("falls back to general for an unknown preset", () => {
    expect(resolveLabels({ verticalPreset: "swimming", labelOverrides: null })).toEqual(LABEL_PRESETS.general);
  });
});
