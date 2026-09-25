import type { Tx } from "@/lib/db/client";
import { whatsappKeys } from "@/modules/integrations/service";
import { httpWhatsapp, type WhatsappApi } from "@/modules/integrations/whatsapp";
import type { Language } from "./templates";

// docs/06 Prompt 17 step 2: sending goes through this, so the provider can change.
export type OutgoingMessage = { to: string; templateName: string; language: Language; variables: string[] };

// manual: no WhatsApp connected (docs/03 §10); staff send it from the To send list.
export type MessagingAdapter = { readonly channel: "manual" } | { readonly channel: "whatsapp"; deliver(message: OutgoingMessage): Promise<string> };

// The academy's own number once connected: an approved Meta template with its
// variables in order; returns Meta's message id. Our language codes are Meta's.
export async function adapterFor(tx: Tx, opts: { api?: WhatsappApi } = {}): Promise<MessagingAdapter> {
  const keys = await whatsappKeys(tx);
  if (!keys) return { channel: "manual" };
  const client = (opts.api ?? httpWhatsapp)(keys);
  return {
    channel: "whatsapp",
    deliver: (m) => client.sendTemplate({ to: m.to, templateName: m.templateName, language: m.language, parameters: m.variables }),
  };
}
