import { json, pathSegment, readJson, scopedCtx, type StaffRequest, withStaffRequest } from "@/lib/auth/route";
import { BadRequestError } from "@/lib/errors";
import { normalizePhone } from "@/lib/phone";
import { type ImportRequest, importStudents } from "./import";
import { searchStudents } from "./repo";
import { STUDENT_STATUSES, type StudentStatus } from "./schema";
import {
  archiveStudent,
  createStudent,
  lookupGuardian,
  setConsent,
  setGuardianWhatsapp,
  setStudentCode,
  setStudentStatus,
  type StudentCtx,
  studentOverview,
  updateStudentDetails,
} from "./service";

export function studentCtx({ session, req }: StaffRequest): StudentCtx {
  return scopedCtx(session, req);
}


export const listStudents = withStaffRequest("students:read", async (r) => {
  const url = new URL(r.req.url);
  const q = url.searchParams.get("q") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  if (status && !(STUDENT_STATUSES as readonly string[]).includes(status)) throw new BadRequestError("Unknown status");
  const rows = await searchStudents(r.tx, { branchIds: r.session.branchIds }, { ...(q ? { q } : {}), ...(status ? { status: status as StudentStatus } : {}) });
  return json({ students: rows });
});

export const addStudent = withStaffRequest("students:create", async (r) => {
  const body = await readJson<Parameters<typeof createStudent>[2]>(r.req);
  const created = await createStudent(r.tx, studentCtx(r), body);
  return json(created, { status: 201 });
});

export const getStudentRoute = withStaffRequest("students:read", async (r) => json(await studentOverview(r.tx, studentCtx(r), pathSegment(r.req, 2))));

export const patchStudent = withStaffRequest("students:update", async (r) => {
  const body = await readJson<{ code?: unknown }>(r.req);
  const id = pathSegment(r.req, 2);
  if (typeof body.code === "string") return json(await setStudentCode(r.tx, studentCtx(r), id, body.code));
  return json(await updateStudentDetails(r.tx, studentCtx(r), id, body as Parameters<typeof updateStudentDetails>[3]));
});

export const changeStatus = withStaffRequest("students:update", async (r) => {
  const body = await readJson<Parameters<typeof setStudentStatus>[3]>(r.req);
  return json(await setStudentStatus(r.tx, studentCtx(r), pathSegment(r.req, 2), body));
});

export const changeConsent = withStaffRequest("students:update", async (r) => {
  const body = await readJson<{ kind?: unknown; granted?: unknown }>(r.req);
  if (body.kind !== "photo" && body.kind !== "medical" && body.kind !== "waiver" && body.kind !== "data_processing") throw new BadRequestError("Unknown consent kind");
  await setConsent(r.tx, studentCtx(r), pathSegment(r.req, 2), body.kind, body.granted === true);
  return json({ ok: true });
});

export const removeStudent = withStaffRequest("students:update", async (r) => {
  await archiveStudent(r.tx, studentCtx(r), pathSegment(r.req, 2));
  return json({ ok: true });
});

export const guardianRoute = withStaffRequest("students:update", async (r) => {
  const { whatsappOptin } = await readJson<{ whatsappOptin?: unknown }>(r.req);
  if (typeof whatsappOptin !== "boolean") throw new BadRequestError("Say whether WhatsApp messages are OK");
  const g = await setGuardianWhatsapp(r.tx, studentCtx(r), pathSegment(r.req, 2), whatsappOptin);
  return json({ id: g.id, whatsappOptin: g.whatsappOptin });
});

export const guardianLookup = withStaffRequest("students:read", async (r) => {
  const phone = normalizePhone(new URL(r.req.url).searchParams.get("phone") ?? "");
  if (!phone) return json({ found: null });
  return json({ found: (await lookupGuardian(r.tx, phone)) ?? null });
});

// Dry run unless the body says dryRun: false.
export const importRoute = withStaffRequest("students:import", async (r) => {
  const body = await readJson<ImportRequest & { dryRun?: unknown }>(r.req);
  return json(await importStudents(r.tx, studentCtx(r), body, { dryRun: body.dryRun !== false }));
});
