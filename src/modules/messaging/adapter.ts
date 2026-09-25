import type { Language } from "./templates";

// docs/06 Prompt 17 step 2: sending goes through this, so the provider can change.
export type OutgoingMessage = { to: string; body: string; templateName: string | null; language: Language; variables: string[] };
export type Delivery = { providerMessageId: string } | { byHand: true };

export interface MessagingAdapter {
  readonly channel: "whatsapp" | "manual";
  deliver(message: OutgoingMessage): Promise<Delivery>;
}

// No WhatsApp connected (docs/03 §10): staff send it from the To send list.
export const byHand: MessagingAdapter = { channel: "manual", deliver: async () => ({ byHand: true }) };

// The academy's own WhatsApp number once connected (Meta Cloud API, step 3).
export function adapterFor(): MessagingAdapter {
  return byHand;
}
