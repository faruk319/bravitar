import { json, scopedCtx, type StaffRequest, withStaffRequest } from "@/lib/auth/route";
import { BadRequestError } from "@/lib/errors";
import {
  addHoliday,
  addProgram,
  archiveBatch,
  batchDetail,
  batchViews,
  changeSchedule,
  closeBatch,
  createBatch,
  editBatch,
  editProgram,
  holidayList,
  programList,
  removeHoliday,
  reopenBatch,
} from "./service";

const seg = (req: Request, i: number) => new URL(req.url).pathname.split("/").filter(Boolean)[i] ?? "";
const read = async <T>(req: Request): Promise<T> => (await req.json().catch(() => ({}))) as T;
const ctxOf = (r: StaffRequest) => scopedCtx(r.session, r.req);

export const listProgramsRoute = withStaffRequest("batches:read", async (r) => json({ programs: await programList(r.tx, ctxOf(r)) }));
export const addProgramRoute = withStaffRequest("programs:manage", async (r) => json(await addProgram(r.tx, ctxOf(r), await read(r.req)), { status: 201 }));
export const editProgramRoute = withStaffRequest("programs:manage", async (r) => json(await editProgram(r.tx, ctxOf(r), seg(r.req, 2), await read(r.req))));

export const listBatchesRoute = withStaffRequest("batches:read", async (r) => {
  const ended = new URL(r.req.url).searchParams.get("ended") === "1";
  return json({ batches: await batchViews(r.tx, ctxOf(r), { includeEnded: ended }) });
});
export const addBatchRoute = withStaffRequest("batches:manage", async (r) => json(await createBatch(r.tx, ctxOf(r), await read(r.req)), { status: 201 }));
export const getBatchRoute = withStaffRequest("batches:read", async (r) => json(await batchDetail(r.tx, ctxOf(r), seg(r.req, 2))));
export const editBatchRoute = withStaffRequest("batches:manage", async (r) => json(await editBatch(r.tx, ctxOf(r), seg(r.req, 2), await read(r.req))));
export const deleteBatchRoute = withStaffRequest("batches:manage", async (r) => {
  await archiveBatch(r.tx, ctxOf(r), seg(r.req, 2));
  return json({ ok: true });
});
export const scheduleRoute = withStaffRequest("batches:manage", async (r) => json(await changeSchedule(r.tx, ctxOf(r), seg(r.req, 2), await read(r.req))));
export const statusRoute = withStaffRequest("batches:manage", async (r) => {
  const b = await read<{ action?: string; endDate?: string }>(r.req);
  if (b.action === "close") return json(await closeBatch(r.tx, ctxOf(r), seg(r.req, 2), b.endDate ? { endDate: b.endDate } : {}));
  if (b.action === "reopen") return json(await reopenBatch(r.tx, ctxOf(r), seg(r.req, 2)));
  throw new BadRequestError("Unknown action");
});

export const listHolidaysRoute = withStaffRequest("batches:read", async (r) => {
  const from = new URL(r.req.url).searchParams.get("from") ?? undefined;
  return json({ holidays: await holidayList(r.tx, ctxOf(r), from ? { from } : {}) });
});
export const addHolidayRoute = withStaffRequest("batches:manage", async (r) => json(await addHoliday(r.tx, ctxOf(r), await read(r.req)), { status: 201 }));
export const deleteHolidayRoute = withStaffRequest("batches:manage", async (r) => {
  await removeHoliday(r.tx, ctxOf(r), seg(r.req, 2));
  return json({ ok: true });
});
