import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { KnownGuardian } from "@/modules/students/service";
import { KnownGuardianChoice } from "./known-guardian";

const nothingVisible: KnownGuardian = { guardianId: "", fullName: "", phone: "9876500001", linked: false, members: [], hidden: 2 };
const render = (onOther?: () => void) => renderToStaticMarkup(createElement(KnownGuardianChoice, { known: nothingVisible, linked: false, onLink: () => {}, ...(onOther ? { onOther } : {}) }));

describe("KnownGuardianChoice with nothing visible", () => {
  it("tells staff to ask an owner when there is no other number to use", () => {
    expect(render()).toContain("used at another branch. Ask an owner.");
  });
  it("offers another number instead when the form can", () => {
    const html = render(() => {});
    expect(html).toContain("Use another number");
    expect(html).not.toContain("Ask an owner");
  });
});
