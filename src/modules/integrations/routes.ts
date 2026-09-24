import { json, readJson, scopedCtx, type StaffRequest, withStaffRequest } from "@/lib/auth/route";
import { connectRazorpay, testRazorpay } from "./service";

const ctxOf = (r: StaffRequest) => scopedCtx(r.session, r.req);

// The response is the connection's status; never the keys.
export const connectRazorpayRoute = withStaffRequest("integrations:manage", async (r) => json(await connectRazorpay(r.tx, ctxOf(r), await readJson(r.req))));

export const testRazorpayRoute = withStaffRequest("integrations:manage", async (r) => json(await testRazorpay(r.tx, ctxOf(r))));
