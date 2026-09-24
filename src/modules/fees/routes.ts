import { json, pathSegment, readJson, scopedCtx, type StaffRequest, withStaffRequest } from "@/lib/auth/route";
import { BadRequestError } from "@/lib/errors";
import { createDiscount, createPlan, editPlan, endDiscount, generateNow, giveDiscount, issueInvoices, saveFeeSettings, setDiscountActive, setPlanActive, voidInvoice } from "./service";

const ctxOf = (r: StaffRequest) => scopedCtx(r.session, r.req);

export const addPlanRoute = withStaffRequest("fee_plans:manage", async (r) => json(await createPlan(r.tx, ctxOf(r), await readJson(r.req)), { status: 201 }));

// { isActive } archives or restores; anything else is an edit.
export const editPlanRoute = withStaffRequest("fee_plans:manage", async (r) => {
  const body = await readJson<Parameters<typeof editPlan>[3] & { isActive?: unknown }>(r.req);
  const id = pathSegment(r.req, 2);
  if (typeof body.isActive === "boolean") return json(await setPlanActive(r.tx, ctxOf(r), id, body.isActive));
  return json(await editPlan(r.tx, ctxOf(r), id, body));
});

export const addDiscountRoute = withStaffRequest("fee_plans:manage", async (r) => json(await createDiscount(r.tx, ctxOf(r), await readJson(r.req)), { status: 201 }));

export const discountActiveRoute = withStaffRequest("fee_plans:manage", async (r) => {
  const { isActive } = await readJson<{ isActive?: unknown }>(r.req);
  if (typeof isActive !== "boolean") throw new BadRequestError("Say whether it's on or off");
  return json(await setDiscountActive(r.tx, ctxOf(r), pathSegment(r.req, 2), isActive));
});

export const giveDiscountRoute = withStaffRequest("invoices:manage", async (r) => {
  const { studentId, ...body } = await readJson<{ studentId?: string } & Parameters<typeof giveDiscount>[3]>(r.req);
  return json(await giveDiscount(r.tx, ctxOf(r), studentId ?? "", body), { status: 201 });
});

// Ends the discount from today; the record stays.
export const endDiscountRoute = withStaffRequest("invoices:manage", async (r) => {
  await endDiscount(r.tx, ctxOf(r), pathSegment(r.req, 2));
  return json({ ok: true });
});

export const invoicesRoute = withStaffRequest("invoices:manage", async (r) => {
  const { action, ids } = await readJson<{ action?: string; ids: Parameters<typeof issueInvoices>[2] }>(r.req);
  if (action === "generate") return json(await generateNow(r.tx, ctxOf(r)));
  if (action === "issue") return json({ issued: (await issueInvoices(r.tx, ctxOf(r), ids)).length });
  throw new BadRequestError("Unknown action");
});

export const invoiceActionRoute = withStaffRequest("invoices:manage", async (r) => {
  const { action, ...body } = await readJson<{ action?: string } & Parameters<typeof voidInvoice>[3]>(r.req);
  const id = pathSegment(r.req, 2);
  if (action === "issue") return json({ issued: (await issueInvoices(r.tx, ctxOf(r), [id])).length });
  if (action === "void") return json(await voidInvoice(r.tx, ctxOf(r), id, body));
  throw new BadRequestError("Unknown action");
});

export const feeSettingsRoute = withStaffRequest("settings:manage", async (r) => json(await saveFeeSettings(r.tx, ctxOf(r), await readJson(r.req))));
