import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import {
  buildErrorRows,
  IMPORT_FIELDS,
  nameKey,
  normalizeHeader,
  normalizeName,
  parseGender,
  parseIndianDate,
  parseRelation,
  parseYesNo,
  splitPhones,
  suggestMapping,
  validateMapping,
} from "./import-fields";

const today = new Date("2026-09-23T00:00:00Z");

describe("parseIndianDate", () => {
  it("reads day-first dates in the forms registers use", () => {
    expect(parseIndianDate("12/03/2015", today)).toBe("2015-03-12");
    expect(parseIndianDate("03/04/2015", today)).toBe("2015-04-03"); // 3 April, never 4 March
    expect(parseIndianDate("1-7-18", today)).toBe("2018-07-01");
    expect(parseIndianDate("12.03.2015", today)).toBe("2015-03-12");
    expect(parseIndianDate("2015-03-12", today)).toBe("2015-03-12");
    expect(parseIndianDate("12 Mar 2015", today)).toBe("2015-03-12");
    expect(parseIndianDate("12-mar-15", today)).toBe("2015-03-12");
    expect(parseIndianDate("5th May 1998", today)).toBe("1998-05-05");
    expect(parseIndianDate("March 12, 2015", today)).toBe("2015-03-12");
    expect(parseIndianDate("12/03/2015 00:00", today)).toBe("2015-03-12");
  });

  it("pivots two-digit years on the current year", () => {
    expect(parseIndianDate("01/01/26", today)).toBe("2026-01-01");
    expect(parseIndianDate("01/01/27", today)).toBe("1927-01-01");
    expect(parseIndianDate("01/01/98", today)).toBe("1998-01-01");
  });

  it("returns undefined for empty and null for nonsense or impossible dates", () => {
    expect(parseIndianDate("  ", today)).toBeUndefined();
    expect(parseIndianDate("31/02/2015", today)).toBeNull();
    expect(parseIndianDate("13/13/2015", today)).toBeNull();
    expect(parseIndianDate("sometime 2015", today)).toBeNull();
    expect(parseIndianDate("12 Foo 2015", today)).toBeNull();
  });
});

describe("lenient cell parsers", () => {
  it("yes/no in English and Hindi", () => {
    for (const v of ["Yes", "y", "haan", "हाँ", "✓", "1"]) expect(parseYesNo(v), v).toBe(true);
    for (const v of ["No", "n", "nahi", "नहीं", "0"]) expect(parseYesNo(v), v).toBe(false);
    expect(parseYesNo("")).toBeUndefined();
    expect(parseYesNo("maybe")).toBeNull();
  });

  it("gender and relation", () => {
    expect(parseGender("M")).toBe("male");
    expect(parseGender("Girl")).toBe("female");
    expect(parseGender("")).toBeUndefined();
    expect(parseGender("?")).toBeNull();
    expect(parseRelation("Papa")).toBe("father");
    expect(parseRelation("aai")).toBe("mother");
    expect(parseRelation("मम्मी")).toBe("mother");
    expect(parseRelation("mama")).toBe("other"); // maternal uncle
    expect(parseRelation("cousin")).toBeNull();
  });

  it("names: NFC, spacing and case, Devanagari nukta forms compare equal", () => {
    expect(normalizeName("  Aarav   Deshmukh ")).toBe("Aarav Deshmukh");
    expect(nameKey("AARAV deshmukh")).toBe(nameKey("Aarav  Deshmukh"));
    const precomposed = "ज़ोया"; // ज़ as one code point
    const decomposed = "ज़ोया"; // ज + nukta
    expect(nameKey(precomposed)).toBe(nameKey(decomposed));
    expect(normalizeName(precomposed)).toBe(decomposed.normalize("NFC"));
  });

  it("phone cells with one, two or no valid numbers", () => {
    expect(splitPhones("98765 43210")).toEqual({ phone: "+919876543210", dropped: [], invalid: false });
    expect(splitPhones("98765 43210 / 91234 56789")).toEqual({ phone: "+919876543210", dropped: ["+919123456789"], invalid: false });
    expect(splitPhones("98765 43210 or 91234 56789").dropped).toEqual(["+919123456789"]);
    expect(splitPhones("12345")).toEqual({ dropped: [], invalid: true });
    expect(splitPhones("")).toEqual({ dropped: [], invalid: false });
  });
});

describe("header mapping", () => {
  it("normalises headers and keeps Devanagari vowel signs", () => {
    expect(normalizeHeader("Father's Name")).toBe("fathers name");
    expect(normalizeHeader("D.O.B")).toBe("dob");
    expect(normalizeHeader("Mobile No.")).toBe("mobile no");
    expect(normalizeHeader("पिता का नाम")).toBe("पिता का नाम");
  });

  it("maps a typical register, turning Name into First name when there is a Surname", () => {
    const { mapping, relation } = suggestMapping(["Sr No", "Name", "Surname", "Father's Name", "Mobile", "D.O.B", "Gender", "Branch", "Joining Date", "Photo"]);
    expect(mapping).toEqual({ firstName: 1, lastName: 2, guardianName: 3, guardianPhone: 4, dateOfBirth: 5, gender: 6, branch: 7, joinedOn: 8, photoConsent: 9 });
    expect(relation).toBe("father");
    expect(validateMapping(mapping, 10)).toEqual([]);
  });

  it("maps looser and Hindi headers", () => {
    expect(suggestMapping(["Student Full Name", "Mother Mobile Number", "Date Of Birth (DD/MM/YYYY)", "Course Enrolled"]).mapping).toEqual({
      fullName: 0,
      guardianPhone: 1,
      dateOfBirth: 2,
      programInterest: 3,
    });
    const hindi = suggestMapping(["नाम", "माता का नाम", "मोबाइल", "जन्म तिथि"]);
    expect(hindi.mapping).toEqual({ fullName: 0, guardianName: 1, guardianPhone: 2, dateOfBirth: 3 });
    expect(hindi.relation).toBe("mother");
  });

  it("a WhatsApp consent column is the opt-in; a WhatsApp number column is still the phone", () => {
    expect(suggestMapping(["Name", "Mobile", "WhatsApp OK"]).mapping).toEqual({ fullName: 0, guardianPhone: 1, whatsappOptIn: 2 });
    expect(suggestMapping(["Name", "WhatsApp No", "Whatsapp (yes/no)"]).mapping).toEqual({ fullName: 0, guardianPhone: 1, whatsappOptIn: 2 });
    expect(suggestMapping(["Name", "WhatsApp Number"]).mapping).toEqual({ fullName: 0, guardianPhone: 1 });
  });

  it("maps every column of the downloadable template", () => {
    const [header] = parseCsv(readFileSync("public/templates/students.csv", "utf8"));
    const { mapping } = suggestMapping(header ?? []);
    const expected = IMPORT_FIELDS.filter((f) => f !== "firstName" && f !== "lastName");
    expect(Object.keys(mapping).sort()).toEqual([...expected].sort());
  });

  it("validates what the import needs", () => {
    expect(validateMapping({ guardianPhone: 0 })).toEqual(["Pick the column with the name"]);
    expect(validateMapping({ fullName: 0 })).toEqual(["Pick the column with the phone number"]);
    expect(validateMapping({ fullName: 0, firstName: 1, guardianPhone: 2 })).toContain("Use either a full-name column or first and last name, not both");
    expect(validateMapping({ fullName: 0, guardianPhone: 0 })).toContain("One column is used twice");
    expect(validateMapping({ fullName: 0, guardianPhone: 5 }, 3)).toContain("Column mapping doesn't match the file");
  });
});

describe("buildErrorRows", () => {
  it("returns the original columns plus the reason, padded to the header width", () => {
    const records = [["Name", "Mobile"], ["Zoya", "12345"], ["Ishaan"]];
    expect(buildErrorRows(records[0] ?? [], records, [{ row: 2, message: "bad phone" }, { row: 3, message: "No phone number" }])).toEqual([
      ["Name", "Mobile", "Import error"],
      ["Zoya", "12345", "bad phone"],
      ["Ishaan", "", "No phone number"],
    ]);
  });
});
