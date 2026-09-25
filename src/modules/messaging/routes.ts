import { json, readJson, scopedCtx, withStaffRequest } from "@/lib/auth/route";
import { type ComposeRequest, composeMessage } from "./service";

export const composeRoute = withStaffRequest("messages:send", async (r) => json(await composeMessage(r.tx, scopedCtx(r.session, r.req), await readJson<ComposeRequest>(r.req))));
