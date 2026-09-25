import { AppError } from "@/lib/errors";
import { slugFromHost } from "@/modules/auth/routes";
import { payOnlineUrl } from "@/modules/messaging/public";

// "Pay online" from a family's private invoice link: straight to the academy's
// own Razorpay link for the balance; back to the invoice if that can't be made.
export async function GET(req: Request): Promise<Response> {
  const token = new URL(req.url).pathname.split("/")[2] ?? "";
  try {
    const url = await payOnlineUrl(token, slugFromHost(req.headers.get("host")));
    if (url) return Response.redirect(url, 303);
  } catch (e) {
    if (!(e instanceof AppError)) console.error(e);
  }
  return Response.redirect(new URL(`/i/${token}?error=1`, req.url), 303);
}
