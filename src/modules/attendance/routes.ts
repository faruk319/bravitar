import { json, pathSegment, readJson, scopedCtx, withStaffRequest } from "@/lib/auth/route";
import { saveAttendance } from "./service";

export const saveAttendanceRoute = withStaffRequest("attendance:mark", async (r) =>
  json(await saveAttendance(r.tx, scopedCtx(r.session, r.req), pathSegment(r.req, 2), await readJson<Parameters<typeof saveAttendance>[3]>(r.req))),
);
