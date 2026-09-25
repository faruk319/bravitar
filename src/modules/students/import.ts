import { sql, TransactionRollbackError } from "drizzle-orm";
import { ZodError, z } from "zod";
import { assertCan } from "@/lib/auth/can";
import { isBlankRow, parseCsv } from "@/lib/csv";
import { writeAudit } from "@/lib/db/audit";
import type { Tx } from "@/lib/db/client";
import { AppError, BadRequestError, NotFoundError } from "@/lib/errors";
import { formatPhone } from "@/lib/phone";
import { isMinor } from "@/lib/students/age";
import { listBranches } from "@/modules/tenancy/repo";
import {
  IMPORT_FIELDS,
  IMPORT_MAX_CHARS,
  IMPORT_MAX_ROWS,
  type ImportField,
  type ImportMapping,
  type ImportResult,
  nameKey,
  normalizeName,
  parseGender,
  parseIndianDate,
  parseRelation,
  parseYesNo,
  splitPhones,
  validateMapping,
} from "./import-fields";
import { findGuardianByPhone, studentsOfHousehold } from "./repo";
import { createStudent, type NewStudentInput, type StudentCtx } from "./service";

export const importRequestSchema = z.object({
  csv: z.string().max(IMPORT_MAX_CHARS, "The file is too large; split it into smaller files"),
  mapping: z.partialRecord(z.enum(IMPORT_FIELDS), z.number().int().min(0)),
  options: z.object({
    defaultRelation: z.enum(["father", "mother", "other"]).default("father"),
    defaultBranchId: z.uuid().optional(),
    consentDeclared: z.boolean().default(false),
    fileName: z.string().max(200).optional(),
  }),
});
export type ImportRequest = z.input<typeof importRequestSchema>;

export type { ImportResult };

type Relation = "father" | "mother" | "other";
type Contact = { kind: "guardian"; phone: string; name?: string; relation: Relation; studentPhone?: string } | { kind: "self"; phone: string };
type RowPlan =
  | { ok: false; message: string }
  | {
      ok: true;
      fullName: string;
      key: string;
      dateOfBirth?: string;
      gender?: "male" | "female" | "other";
      joinedOn?: string;
      programInterest?: string;
      branchName: string;
      photo?: boolean;
      whatsapp?: boolean;
      contact: Contact;
      warnings: string[];
    };

// Everything about a row that needs no database: names, dates, phones and
// which phone is the family's (see the import rules in docs/03 §3).
export function planRow(cells: string[], mapping: ImportMapping, defaultRelation: Relation, today: Date = new Date()): RowPlan {
  const cell = (f: ImportField) => (mapping[f] === undefined ? "" : (cells[mapping[f]] ?? "").trim());
  const fullName = normalizeName(mapping.fullName !== undefined ? cell("fullName") : `${cell("firstName")} ${cell("lastName")}`);
  if (!fullName) return { ok: false, message: "No name" };
  if ([...fullName].length < 2) return { ok: false, message: "Name is too short" };
  if (fullName.length > 120) return { ok: false, message: "Name is too long" };

  const warnings: string[] = [];
  const todayIso = today.toISOString().slice(0, 10);

  const dobRaw = cell("dateOfBirth");
  const dob = parseIndianDate(dobRaw, today);
  let dateOfBirth = dob ?? undefined;
  if (dob === null || (dob && dob > todayIso)) {
    warnings.push(`Couldn't read date of birth "${dobRaw}"; left blank`);
    dateOfBirth = undefined;
  }
  const joinedRaw = cell("joinedOn");
  const joined = parseIndianDate(joinedRaw, today);
  if (joined === null) warnings.push(`Couldn't read joining date "${joinedRaw}"; used today`);
  const gender = parseGender(cell("gender"));
  if (gender === null) warnings.push(`Couldn't read gender "${cell("gender")}"; left blank`);
  const photo = parseYesNo(cell("photoConsent"));
  if (photo === null) warnings.push(`Couldn't read photo consent "${cell("photoConsent")}"; photos not allowed`);
  const whatsapp = parseYesNo(cell("whatsappOptIn"));
  if (whatsapp === null) warnings.push(`Couldn't read WhatsApp consent "${cell("whatsappOptIn")}"; no automated messages`);
  const rel = parseRelation(cell("relation"));
  if (rel === null) warnings.push(`Couldn't read relation "${cell("relation")}"; used ${defaultRelation}`);
  const relation: Relation = rel ?? defaultRelation;

  const gp = splitPhones(cell("guardianPhone"));
  const sp = splitPhones(cell("studentPhone"));
  if (gp.invalid) return { ok: false, message: `Phone "${cell("guardianPhone")}" isn't a 10-digit mobile` };
  if (sp.invalid && !gp.phone) return { ok: false, message: `Phone "${cell("studentPhone")}" isn't a 10-digit mobile` };
  if (sp.invalid) warnings.push(`Couldn't read ${fullName}'s own phone "${cell("studentPhone")}"; not kept`);
  for (const p of [gp, sp]) if (p.phone && p.dropped.length) warnings.push(`Kept ${formatPhone(p.phone)}; dropped ${p.dropped.map(formatPhone).join(", ")}`);
  const familyPhone = gp.phone ?? sp.phone;
  if (!familyPhone) return { ok: false, message: "No phone number" };

  const adult = dateOfBirth !== undefined && !isMinor(dateOfBirth, today);
  const guardianName = normalizeName(cell("guardianName")) || undefined;
  const distinctOwnPhone = sp.phone && sp.phone !== gp.phone ? sp.phone : undefined;
  let contact: Contact;
  if (adult && (!guardianName || !gp.phone)) {
    // An adult with no named parent, or no parent phone: the number is theirs.
    contact = { kind: "self", phone: sp.phone ?? familyPhone };
    if (gp.phone && distinctOwnPhone) warnings.push("Parent phone not kept (no parent name)");
  } else {
    contact = { kind: "guardian", phone: familyPhone, relation, ...(guardianName ? { name: guardianName } : {}) };
    if (!gp.phone) warnings.push("Used the student's phone as the parent's phone");
    else if (distinctOwnPhone && adult) contact.studentPhone = distinctOwnPhone;
    else if (distinctOwnPhone) warnings.push("Student's own phone not kept (under 18)");
  }

  return {
    ok: true,
    fullName,
    key: nameKey(fullName),
    ...(dateOfBirth ? { dateOfBirth } : {}),
    ...(gender ? { gender } : {}),
    ...(joined ? { joinedOn: joined } : {}),
    ...(cell("programInterest") ? { programInterest: normalizeName(cell("programInterest")).slice(0, 120) } : {}),
    branchName: cell("branch"),
    ...(photo !== null && photo !== undefined ? { photo } : {}),
    ...(whatsapp ? { whatsapp } : {}),
    contact,
    warnings,
  };
}

const FIELD_NAMES: Record<string, string> = {
  fullName: "Name",
  "guardian.fullName": "Parent name",
  "guardian.phone": "Parent phone",
  adultPhone: "Phone",
  dateOfBirth: "Date of birth",
  joinedOn: "Joined on",
  programInterest: "Interested in",
};

function rowMessage(e: unknown): string {
  if (e instanceof ZodError) {
    const issue = e.issues[0];
    const path = issue?.path.join(".") ?? "";
    return issue ? `${FIELD_NAMES[path] ?? path}: ${issue.message}` : "Invalid row";
  }
  if (e instanceof AppError) return e.message;
  console.error("student import row failed", e);
  return "Could not save this row";
}

type RowOutcome = { kind: "skipped" } | { kind: "created"; householdId: string; existingHouseholdId?: string };

// Dry run and import are the same code: a dry run rolls the savepoint back.
export async function importStudents(tx: Tx, ctx: StudentCtx, input: ImportRequest, opts: { dryRun: boolean }): Promise<ImportResult> {
  assertCan(ctx, "students:import");
  assertCan(ctx, "students:create");
  const req = importRequestSchema.parse(input);
  if (!opts.dryRun && !req.options.consentDeclared) throw new BadRequestError("Confirm that parents gave consent for these records");

  const [header, ...data] = parseCsv(req.csv);
  if (!header || data.every(isBlankRow)) throw new BadRequestError("The file has no rows under the header");
  if (data.length > IMPORT_MAX_ROWS) throw new BadRequestError(`Up to ${IMPORT_MAX_ROWS} rows per file; split it into smaller files`);
  const mappingErrors = validateMapping(req.mapping, header.length);
  if (mappingErrors[0]) throw new BadRequestError(mappingErrors[0]);

  // One import per academy at a time, so the second sees the first's students.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`students.import:${ctx.tenantId}`}, 0))`);

  const branches = (await listBranches(tx)).filter((b) => !ctx.branchIds.length || ctx.branchIds.includes(b.id));
  if (req.options.defaultBranchId && !branches.some((b) => b.id === req.options.defaultBranchId)) throw new NotFoundError("Branch");
  const branchByName = new Map(branches.map((b) => [nameKey(b.name), b.id]));

  const result: ImportResult = { dryRun: opts.dryRun, rows: 0, studentsCreated: 0, householdsCreated: 0, linkedToExisting: 0, skipped: 0, errors: [], warnings: [] };
  const newHouseholds = new Set<string>();
  const today = new Date();

  const run = async (sp: Tx) => {
    for (const [i, cells] of data.entries()) {
      if (isBlankRow(cells)) continue;
      const row = i + 2; // the header is row 1, as in the spreadsheet
      result.rows++;
      const plan = planRow(cells, req.mapping, req.options.defaultRelation, today);
      if (!plan.ok) {
        result.errors.push({ row, message: plan.message });
        continue;
      }
      let branchId = req.options.defaultBranchId;
      if (plan.branchName) {
        branchId = branchByName.get(nameKey(plan.branchName));
        if (!branchId) {
          result.errors.push({ row, message: `Unknown branch "${plan.branchName}"` });
          continue;
        }
      }
      const warnings = [...plan.warnings];
      try {
        const outcome = await sp.transaction(async (rowTx): Promise<RowOutcome> => {
          const existing = await findGuardianByPhone(rowTx, plan.contact.phone);
          if (existing && (await studentsOfHousehold(rowTx, existing.householdId)).some((s) => nameKey(s.fullName) === plan.key)) return { kind: "skipped" };

          const base = {
            fullName: plan.fullName,
            ...(plan.dateOfBirth ? { dateOfBirth: plan.dateOfBirth } : {}),
            ...(plan.gender ? { gender: plan.gender } : {}),
            ...(plan.joinedOn ? { joinedOn: plan.joinedOn } : {}),
            ...(plan.programInterest ? { programInterest: plan.programInterest } : {}),
            ...(branchId ? { branchId } : {}),
            ...(existing ? { householdId: existing.householdId } : {}),
            consents: { dataProcessing: true, ...(plan.photo !== undefined ? { photo: plan.photo } : {}), ...(plan.whatsapp ? { whatsapp: true } : {}) },
          };
          let studentInput: NewStudentInput;
          const c = plan.contact;
          if (c.kind === "self") {
            if (existing && nameKey(existing.fullName) !== plan.key) {
              warnings.push(`Shares a phone with ${existing.fullName}; added to that family`);
              studentInput = { ...base, guardian: { fullName: existing.fullName, phone: c.phone, relation: "other" } };
            } else {
              studentInput = { ...base, adultPhone: c.phone };
            }
          } else {
            let guardianName = c.name;
            if (existing) {
              if (guardianName && nameKey(guardianName) !== nameKey(existing.fullName)) warnings.push(`Phone belongs to ${existing.fullName}; added to that family`);
              guardianName = existing.fullName;
            } else if (!guardianName) {
              guardianName = `Parent of ${plan.fullName}`;
              warnings.push(`No parent name; saved as "${guardianName}"`);
            }
            studentInput = { ...base, guardian: { fullName: guardianName, phone: c.phone, relation: c.relation }, ...(c.studentPhone ? { adultPhone: c.studentPhone } : {}) };
          }
          const created = await createStudent(rowTx, ctx, studentInput, { consentMethod: "paper", source: "csv_import" });
          return { kind: "created", householdId: created.household.id, ...(existing ? { existingHouseholdId: existing.householdId } : {}) };
        });
        if (outcome.kind === "skipped") {
          result.skipped++;
          continue;
        }
        result.studentsCreated++;
        if (!outcome.existingHouseholdId) {
          result.householdsCreated++;
          newHouseholds.add(outcome.householdId);
        } else if (!newHouseholds.has(outcome.existingHouseholdId)) {
          result.linkedToExisting++;
        }
        for (const message of warnings) result.warnings.push({ row, message });
      } catch (e) {
        result.errors.push({ row, message: rowMessage(e) });
      }
    }
  };

  try {
    await tx.transaction(async (sp) => {
      await run(sp);
      if (opts.dryRun) sp.rollback();
    });
  } catch (e) {
    if (!(e instanceof TransactionRollbackError)) throw e;
  }

  if (!opts.dryRun) {
    const { errors, warnings, ...counts } = result;
    await writeAudit(tx, {
      actorType: "staff",
      actorId: ctx.staffId,
      tenantId: ctx.tenantId,
      action: "students.import",
      entityType: "student",
      after: { ...counts, errors: errors.length, warnings: warnings.length, fileName: req.options.fileName ?? null },
      ...(ctx.ip ? { ip: ctx.ip } : {}),
    });
  }
  return result;
}
