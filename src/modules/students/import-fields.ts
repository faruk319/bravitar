import { normalizePhone } from "@/lib/phone";

// Pure rules for CSV import, shared by the browser preview and the server.

export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_MAX_CHARS = 5_000_000;

export type ImportIssue = { row: number; message: string };
export type ImportResult = {
  dryRun: boolean;
  rows: number;
  studentsCreated: number;
  householdsCreated: number;
  linkedToExisting: number;
  skipped: number;
  errors: ImportIssue[];
  warnings: ImportIssue[];
};

export const IMPORT_FIELDS = [
  "fullName",
  "firstName",
  "lastName",
  "dateOfBirth",
  "gender",
  "guardianName",
  "guardianPhone",
  "relation",
  "studentPhone",
  "programInterest",
  "branch",
  "joinedOn",
  "photoConsent",
  "whatsappOptIn",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ImportMapping = Partial<Record<ImportField, number>>;

// {student.one} is filled from the tenant's label pack in the UI.
export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  fullName: "{student.one} name",
  firstName: "First name",
  lastName: "Last name",
  dateOfBirth: "Date of birth",
  gender: "Gender",
  guardianName: "Parent name",
  guardianPhone: "Parent phone",
  relation: "Relation",
  studentPhone: "{student.one} phone (adults)",
  programInterest: "Interested in",
  branch: "Branch",
  joinedOn: "Joined on",
  photoConsent: "Photo consent",
  whatsappOptIn: "WhatsApp messages OK",
};

// Lower-case, no punctuation; keeps Devanagari vowel signs (\p{M}).
export function normalizeHeader(h: string): string {
  return h
    .normalize("NFC")
    .toLowerCase()
    .replace(/['’`.]/g, "")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

const SYNONYMS: Record<ImportField, string[]> = {
  fullName: ["name", "student name", "students name", "full name", "child name", "childs name", "student", "name of student", "नाम", "विद्यार्थी का नाम", "छात्र का नाम"],
  firstName: ["first name", "firstname", "given name", "fname"],
  lastName: ["last name", "lastname", "surname", "family name", "lname"],
  dateOfBirth: ["dob", "date of birth", "birth date", "birthdate", "birthday", "जन्म तिथि", "जन्मतिथि"],
  gender: ["gender", "sex", "लिंग"],
  guardianName: ["father name", "fathers name", "mother name", "mothers name", "parent name", "parents name", "guardian", "guardian name", "parent", "पिता का नाम", "माता का नाम", "पालक"],
  guardianPhone: ["phone", "mobile", "mobile no", "mobile number", "phone no", "phone number", "contact", "contact no", "contact number", "whatsapp", "whatsapp no", "parent phone", "parent mobile", "father mobile", "fathers mobile", "mother mobile", "guardian phone", "guardian mobile", "मोबाइल", "फोन", "फ़ोन"],
  relation: ["relation", "relationship", "संबंध"],
  studentPhone: ["student phone", "student mobile", "students phone", "students mobile", "own phone"],
  programInterest: ["program", "programme", "course", "class", "batch", "subject", "interested in", "activity", "sport"],
  branch: ["branch", "centre", "center", "location"],
  joinedOn: ["joined", "joined on", "joining date", "date of joining", "doj", "admission date", "date of admission", "admission"],
  photoConsent: ["photo", "photos", "photo consent", "photo permission"],
  whatsappOptIn: ["whatsapp ok", "whatsapp consent", "whatsapp opt in", "whatsapp optin", "whatsapp messages", "whatsapp permission", "whatsapp allowed"],
};

// Looser rules for headers the synonyms miss, tried in this order.
const KEYWORDS: [ImportField, (h: string) => boolean][] = [
  ["whatsappOptIn", (h) => /whatsapp/.test(h) && /\b(ok|consent|opt|allow|permission|messages?|yes)\b/.test(h)],
  ["dateOfBirth", (h) => /birth|\bdob\b|जन्म/.test(h)],
  ["guardianPhone", (h) => /father|mother|parent|guardian|पिता|माता|पालक/.test(h) && /phone|mobile|contact|whatsapp|मोबाइल|फोन/.test(h)],
  ["studentPhone", (h) => /student/.test(h) && /phone|mobile|contact/.test(h)],
  ["guardianName", (h) => /father|mother|parent|guardian|पिता|माता|पालक/.test(h)],
  ["guardianPhone", (h) => /phone|mobile|contact|whatsapp|मोबाइल|फोन/.test(h)],
  ["joinedOn", (h) => /join|admission|\bdoj\b/.test(h)],
  ["firstName", (h) => /first/.test(h) && /name/.test(h)],
  ["lastName", (h) => /(last|sur)\s?name/.test(h)],
  ["fullName", (h) => /name|नाम/.test(h)],
  ["gender", (h) => /gender|\bsex\b/.test(h)],
  ["branch", (h) => /branch|centre|center/.test(h)],
  ["photoConsent", (h) => /photo/.test(h)],
  ["programInterest", (h) => /course|class|batch|program|subject|sport/.test(h)],
];

export type MappingSuggestion = { mapping: ImportMapping; relation?: "father" | "mother" };

export function suggestMapping(headers: string[]): MappingSuggestion {
  const mapping: ImportMapping = {};
  const norm = headers.map(normalizeHeader);
  const taken = new Set<number>();
  norm.forEach((h, i) => {
    const field = IMPORT_FIELDS.find((f) => mapping[f] === undefined && SYNONYMS[f].includes(h));
    if (field) {
      mapping[field] = i;
      taken.add(i);
    }
  });
  norm.forEach((h, i) => {
    if (taken.has(i) || !h) return;
    const hit = KEYWORDS.find(([f, test]) => mapping[f] === undefined && test(h));
    if (hit) {
      mapping[hit[0]] = i;
      taken.add(i);
    }
  });
  // "Name" next to "Surname" is a first name.
  if (mapping.fullName !== undefined && mapping.lastName !== undefined && mapping.firstName === undefined) {
    mapping.firstName = mapping.fullName;
    delete mapping.fullName;
  }
  const parentHeader = mapping.guardianName === undefined ? "" : (norm[mapping.guardianName] ?? "");
  const relation = /mother|माता/.test(parentHeader) ? "mother" : /father|पिता/.test(parentHeader) ? "father" : undefined;
  return relation ? { mapping, relation } : { mapping };
}

export function validateMapping(mapping: ImportMapping, columnCount?: number): string[] {
  const errors: string[] = [];
  if (mapping.fullName === undefined && mapping.firstName === undefined) errors.push("Pick the column with the name");
  if (mapping.fullName !== undefined && (mapping.firstName !== undefined || mapping.lastName !== undefined)) errors.push("Use either a full-name column or first and last name, not both");
  if (mapping.guardianPhone === undefined && mapping.studentPhone === undefined) errors.push("Pick the column with the phone number");
  const used = Object.values(mapping);
  if (new Set(used).size !== used.length) errors.push("One column is used twice");
  if (columnCount !== undefined && used.some((i) => i < 0 || i >= columnCount)) errors.push("Column mapping doesn't match the file");
  return errors;
}

export function normalizeName(s: string): string {
  return s.normalize("NFC").replace(/\s+/g, " ").trim();
}

// Same person, whatever the spacing, case or Unicode form.
export function nameKey(s: string): string {
  return normalizeName(s).toLocaleLowerCase("en-IN");
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function isoDate(y: number, m: number, d: number): string | undefined {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function fullYear(y: string, today: Date): number {
  if (y.length === 4) return Number(y);
  const yy = Number(y);
  return yy <= today.getUTCFullYear() % 100 ? 2000 + yy : 1900 + yy;
}

// Indian order only: 03/04/2015 is 3 April. undefined = empty, null = unreadable.
export function parseIndianDate(raw: string, today: Date = new Date()): string | undefined | null {
  const s = raw.trim().toLowerCase().replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s*[ap]m)?$/, "");
  if (!s) return undefined;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3])) ?? null;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (m) return isoDate(fullYear(m[3] ?? "", today), Number(m[2]), Number(m[1])) ?? null;
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s\-/.,]*([a-z]{3,9})[\s\-/.,]*(\d{2}|\d{4})$/.exec(s);
  if (m && MONTHS[m[2] ?? ""]) return isoDate(fullYear(m[3] ?? "", today), MONTHS[m[2] ?? ""] ?? 0, Number(m[1])) ?? null;
  m = /^([a-z]{3,9})[\s\-/.,]*(\d{1,2})(?:st|nd|rd|th)?[\s,]+(\d{4})$/.exec(s);
  if (m && MONTHS[m[1] ?? ""]) return isoDate(Number(m[3]), MONTHS[m[1] ?? ""] ?? 0, Number(m[2])) ?? null;
  return null;
}

function lookup<T>(table: Record<string, T>, raw: string): T | undefined | null {
  const s = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!s) return undefined;
  return Object.hasOwn(table, s) ? (table[s] as T) : null;
}

const YES_NO: Record<string, boolean> = {
  yes: true, y: true, true: true, "1": true, haan: true, han: true, ha: true, "हाँ": true, "हां": true, "✓": true, "✔": true, ok: true, allowed: true,
  no: false, n: false, false: false, "0": false, nahi: false, nahin: false, "नहीं": false, "नही": false, "✗": false, "✘": false, x: false, "not allowed": false,
};
export const parseYesNo = (raw: string) => lookup(YES_NO, raw);

const GENDERS: Record<string, "male" | "female" | "other"> = {
  m: "male", male: "male", boy: "male", b: "male", "पुरुष": "male", "लड़का": "male", mulga: "male",
  f: "female", female: "female", girl: "female", g: "female", "महिला": "female", "स्त्री": "female", "लड़की": "female", mulgi: "female",
  o: "other", other: "other", x: "other",
};
export const parseGender = (raw: string) => lookup(GENDERS, raw);

// "mama" is a maternal uncle in Hindi, so it is deliberately "other".
const RELATIONS: Record<string, "father" | "mother" | "other"> = {
  father: "father", f: "father", dad: "father", daddy: "father", papa: "father", pappa: "father", pitaji: "father", baba: "father", "पिता": "father", "पापा": "father", "बाबा": "father",
  mother: "mother", m: "mother", mom: "mother", mum: "mother", mummy: "mother", mommy: "mother", maa: "mother", ma: "mother", aai: "mother", "माता": "mother", "माँ": "mother", "मां": "mother", "मम्मी": "mother", "आई": "mother",
  guardian: "other", other: "other", uncle: "other", aunt: "other", mama: "other", mami: "other", grandfather: "other", grandmother: "other", nana: "other", nani: "other", dada: "other", dadi: "other", brother: "other", sister: "other",
};
export const parseRelation = (raw: string) => lookup(RELATIONS, raw);

export type PhoneCell = { phone?: string; dropped: string[]; invalid: boolean };

// "98765 43210 / 91234 56789": first valid number wins, the rest are reported.
export function splitPhones(raw: string): PhoneCell {
  const s = raw.trim();
  if (!s) return { dropped: [], invalid: false };
  const parts = s.split(/[/,;|]|\s+or\s+|\s{2,}/i).map((p) => p.trim()).filter(Boolean);
  const valid = parts.map((p) => normalizePhone(p)).filter((p): p is string => Boolean(p));
  const [first, ...rest] = valid;
  return first ? { phone: first, dropped: rest, invalid: false } : { dropped: [], invalid: true };
}

// Failed rows in their original shape plus the reason, for fixing and re-uploading.
export function buildErrorRows(header: string[], records: string[][], errors: { row: number; message: string }[]): string[][] {
  const width = header.length;
  const out = [[...header, "Import error"]];
  for (const e of errors) {
    const cells = records[e.row - 1] ?? [];
    out.push([...Array.from({ length: width }, (_, i) => cells[i] ?? ""), e.message]);
  }
  return out;
}
