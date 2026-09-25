// An academy's own WhatsApp number through Meta's Cloud API
// (https://developers.facebook.com/docs/whatsapp/cloud-api). Only ever built
// from that academy's sealed keys (service.ts); nothing here is shared.

export type WhatsappCredentials = { phoneNumberId: string; accessToken: string; appSecret: string; verifyToken: string };
export type WhatsappNumber = { displayPhoneNumber: string; verifiedName: string };
export type TemplateSend = { to: string; templateName: string; language: string; parameters: string[] };
export type CodeSend = { to: string; templateName: string; language: string; code: string };

export interface WhatsappClient {
  number(): Promise<WhatsappNumber>; // proves the id and token work
  sendTemplate(message: TemplateSend): Promise<string>; // Meta's message id (wamid)
  sendCode(message: CodeSend): Promise<string>; // an authentication template with a Copy code button
}

// auth: the token was refused. network: Meta couldn't be reached. api: anything else.
export class WhatsappError extends Error {
  constructor(
    readonly kind: "auth" | "network" | "api",
    message: string,
  ) {
    super(message);
    this.name = "WhatsappError";
  }
}

export type WhatsappApi = (keys: Pick<WhatsappCredentials, "phoneNumberId" | "accessToken">) => WhatsappClient;

const GRAPH = "https://graph.facebook.com/v23.0";

export const httpWhatsapp: WhatsappApi = ({ phoneNumberId, accessToken }) => {
  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${GRAPH}${path}`, {
        method,
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new WhatsappError("network", "Couldn't reach WhatsApp");
    }
    const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
    if (res.status === 401 || json.error?.code === 190) throw new WhatsappError("auth", "WhatsApp didn't accept this access token");
    if (!res.ok) throw new WhatsappError("api", json.error?.message ?? `the request was refused (HTTP ${res.status})`);
    return json;
  }
  const id = encodeURIComponent(phoneNumberId);
  async function send(to: string, name: string, language: string, components: unknown[]): Promise<string> {
    const r = await call<{ messages?: { id: string }[] }>("POST", `/${id}/messages`, { messaging_product: "whatsapp", to, type: "template", template: { name, language: { code: language }, components } });
    const wamid = r.messages?.[0]?.id;
    if (!wamid) throw new WhatsappError("api", "WhatsApp didn't return a message id");
    return wamid;
  }
  return {
    async number() {
      const n = await call<{ display_phone_number?: string; verified_name?: string }>("GET", `/${id}?fields=display_phone_number,verified_name`);
      return { displayPhoneNumber: n.display_phone_number ?? "", verifiedName: n.verified_name ?? "" };
    },
    sendTemplate: (m) =>
      send(m.to, m.templateName, m.language, m.parameters.length ? [{ type: "body", parameters: m.parameters.map((text) => ({ type: "text", text })) }] : []),
    // Meta wants the code twice: in the body and in the Copy code button.
    sendCode: (m) =>
      send(m.to, m.templateName, m.language, [
        { type: "body", parameters: [{ type: "text", text: m.code }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: m.code }] },
      ]),
  };
};
