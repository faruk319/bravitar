import { json, type StaffRequest, withStaffRequest } from "@/lib/auth/route";
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
  setStudentCode,
  setStudentStatus,
  type StudentCtx,
  studentOverview,
  updateStudentDetails,
} from "./service";

// Branch scoping and the requester's IP ride on the context.
export function studentCtx({ session, req }: StaffRequest): StudentCtx {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    tenantId: session.tenant.id,
    staffId: session.actor.id,
    isOwner: session.isOwner,
    modules: session.modules,
    permissions: session.permissions,
    branchIds: session.branchIds,
    ...(ip ? { ip } : {}),
  };
}

const idFrom = (req: Request, segment: number) => new URL(req.url).pathname.split("/").filter(Boolean)[segment] ?? "";

export const listStudents = withStaffRequest("students:read", async (r) => {
  const url = new URL(r.req.url);
  const q = url.searchParams.get("q") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  if (status && !(STUDENT_STATUSES as readonly string[]).includes(status)) throw new BadRequestError("Unknown status");
  const rows = await searchStudents(r.tx, { branchIds: r.session.branchIds }, { ...(q ? { q } : {}), ...(status ? { status: status as StudentStatus } : {}) });
  return json({ students: rows });
});

export const addStudent = withStaffRequest("students:create", async (r) => {
  const body = (await r.req.json().catch(() => ({}))) as Parameters<typeof createStudent>[2];
  const created = await createStudent(r.tx, studentCtx(r), body);
  return json(created, { status: 201 });
});

export const getStudentRoute = withStaffRequest("students:read", async (r) => json(await studentOverview(r.tx, studentCtx(r), idFrom(r.req, 2))));

export const patchStudent = withStaffRequest("students:update", async (r) => {
  const body = (await r.req.json().catch(() => ({}))) as { code?: unknown };
  const id = idFrom(r.req, 2);
  if (typeof body.code === "string") return json(await setStudentCode(r.tx, studentCtx(r), id, body.code));
  return json(await updateStudentDetails(r.tx, studentCtx(r), id, body as Parameters<typeof updateStudentDetails>[3]));
});

export const changeStatus = withStaffRequest("students:update", async (r) => {
  const body = (await r.req.json().catch(() => ({}))) as Parameters<typeof setStudentStatus>[3];
  return json(await setStudentStatus(r.tx, studentCtx(r), idFrom(r.req, 2), body));
});

export const changeConsent = withStaffRequest("students:update", async (r) => {
  const body = (await r.req.json().catch(() => ({}))) as { kind?: unknown; granted?: unknown };
  if (body.kind !== "photo" && body.kind !== "medical" && body.kind !== "waiver" && body.kind !== "data_processing") throw new BadRequestError("Unknown consent kind");
  await setConsent(r.tx, studentCtx(r), idFrom(r.req, 2), body.kind, body.granted === true);
  return json({ ok: true });
});

export const removeStudent = withStaffRequest("students:update", async (r) => {
  await archiveStudent(r.tx, studentCtx(r), idFrom(r.req, 2));
  return json({ ok: true });
});

export const guardianLookup = withStaffRequest("students:read", async (r) => {
  const phone = normalizePhone(new URL(r.req.url).searchParams.get("phone") ?? "");
  if (!phone) return json({ found: null });
  return json({ found: (await lookupGuardian(r.tx, phone)) ?? null });
});

// Dry run unless the body says dryRun: false.
export const importRoute = withStaffRequest("students:import", async (r) => {
  const body = (await r.req.json().catch(() => ({}))) as ImportRequest & { dryRun?: unknown };
  return json(await importStudents(r.tx, studentCtx(r), body, { dryRun: body.dryRun !== false }));
});
