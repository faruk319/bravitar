import { describe, expect, it } from "vitest";
import type { KnownGuardian } from "@/modules/students/service";
import { knownLine } from "./known-line";

const known = (members: { fullName: string; relation: KnownGuardian["members"][number]["relation"] }[], hidden = 0): KnownGuardian => ({
  guardianId: "g",
  fullName: "Rakesh Deshmukh",
  phone: "9876500001",
  linked: false,
  hidden,
  members: members.map((m, i) => ({ studentId: `s${i}`, ...m })),
});

describe("knownLine", () => {
  it("says the relation once, however many children share it", () => {
    expect(knownLine(known([{ fullName: "Aarav Deshmukh", relation: "father" }]))).toBe("This number belongs to Rakesh Deshmukh (father of Aarav Deshmukh).");
    expect(
      knownLine(
        known([
          { fullName: "Aarav Deshmukh", relation: "father" },
          { fullName: "Anaya Deshmukh", relation: "father" },
        ]),
      ),
    ).toBe("This number belongs to Rakesh Deshmukh (father of Aarav Deshmukh and Anaya Deshmukh).");
    expect(
      knownLine(
        known([
          { fullName: "A", relation: "father" },
          { fullName: "B", relation: "father" },
          { fullName: "C", relation: "father" },
        ]),
      ),
    ).toBe("This number belongs to Rakesh Deshmukh (father of A, B and C).");
  });

  it("keeps different relations apart, a self record, and the hidden count", () => {
    expect(
      knownLine(
        known(
          [
            { fullName: "A", relation: "father" },
            { fullName: "B", relation: "guardian" },
            { fullName: "C", relation: "father" },
            { fullName: "Rakesh Deshmukh", relation: "self" },
          ],
          2,
        ),
      ),
    ).toBe("This number belongs to Rakesh Deshmukh (father of A and C, guardian of B, also a member; 2 more at other branches).");
    expect(knownLine(known([], 2))).toBe("This number belongs to Rakesh Deshmukh (2 at other branches).");
  });
});
