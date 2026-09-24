import { json, pathSegment, readJson, scopedCtx, type StaffRequest, withStaffRequest } from "@/lib/auth/route";
import { paymentLinkFor } from "./links";
import { cancelPayment, recordPayment, refundPayment } from "./service";

const ctxOf = (r: StaffRequest) => scopedCtx(r.session, r.req);

// docs/04 "Payment recording". The collect screen goes straight to the receipt.
export const recordPaymentRoute = withStaffRequest("fees:collect", async (r) => json(await recordPayment(r.tx, ctxOf(r), await readJson(r.req)), { status: 201 }));

// Same day only; the service also checks it is the collector's own or they can refund.
export const cancelPaymentRoute = withStaffRequest("fees:collect", async (r) => json(await cancelPayment(r.tx, ctxOf(r), pathSegment(r.req, 2), await readJson(r.req))));

export const refundPaymentRoute = withStaffRequest("fees:refund", async (r) => json(await refundPayment(r.tx, ctxOf(r), pathSegment(r.req, 2), await readJson(r.req)), { status: 201 }));

// docs/03 §9: the invoice's live Razorpay link, made or reused, to share.
export const paymentLinkRoute = withStaffRequest("fees:collect", async (r) => json(await paymentLinkFor(r.tx, ctxOf(r), pathSegment(r.req, 2))));
