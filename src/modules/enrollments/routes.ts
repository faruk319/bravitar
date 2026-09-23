import { json, pathSegment, readJson, scopedCtx, type StaffRequest, withStaffRequest } from "@/lib/auth/route";
import { BadRequestError } from "@/lib/errors";
import { enroll, leaveEnrollment, pauseEnrollment, resumeEnrollment, transferEnrollment } from "./service";

const ctxOf = (r: StaffRequest) => scopedCtx(r.session, r.req);

export const enrollRoute = withStaffRequest("enrollments:manage", async (r) => json(await enroll(r.tx, ctxOf(r), await readJson<Parameters<typeof enroll>[2]>(r.req)), { status: 201 }));

export const enrollmentActionRoute = withStaffRequest("enrollments:manage", async (r) => {
  const { action, ...body } = await readJson<{ action?: string; batchId: string; date?: string }>(r.req);
  const id = pathSegment(r.req, 2);
  if (action === "pause") return json(await pauseEnrollment(r.tx, ctxOf(r), id));
  if (action === "resume") return json(await resumeEnrollment(r.tx, ctxOf(r), id));
  if (action === "transfer") return json(await transferEnrollment(r.tx, ctxOf(r), id, body));
  if (action === "leave") return json(await leaveEnrollment(r.tx, ctxOf(r), id, body));
  throw new BadRequestError("Unknown action");
});
