// docs/03 §10: the six templates, in the academy's language (agreed 2026-09-25:
// English, Hindi, Marathi). Variables are {{snake_case}}; the owner can edit
// the wording later (step 2). No database here.

export const TEMPLATE_KEYS = ["fee_due", "fee_overdue", "receipt", "absent", "class_cancelled", "welcome"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const LANGUAGES = ["en", "hi", "mr"] as const;
export type Language = (typeof LANGUAGES)[number];

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  fee_due: "Fee due soon",
  fee_overdue: "Fee overdue",
  receipt: "Receipt",
  absent: "Absent",
  class_cancelled: "Class cancelled",
  welcome: "Welcome",
};

// What each template may use; anything else in an edited body is refused.
export const TEMPLATE_VARIABLES: Record<TemplateKey, string[]> = {
  fee_due: ["guardian_name", "student_names", "amount", "academy", "due_date", "invoice_number", "link"],
  fee_overdue: ["guardian_name", "student_names", "amount", "academy", "due_date", "invoice_number", "link"],
  receipt: ["guardian_name", "academy", "amount", "date", "receipt_number", "link"],
  absent: ["guardian_name", "student_name", "batch", "academy", "date"],
  class_cancelled: ["guardian_name", "student_name", "batch", "academy", "date", "time", "reason"],
  welcome: ["academy", "guardian_name", "student_name"],
};

// docs/03 §10: at most one automated message per guardian per day per category.
// Sent by the jobs (step 4), so they are the ones sent through Meta; the rest are copied by hand.
export const AUTOMATED_KEYS: readonly TemplateKey[] = ["fee_due", "fee_overdue", "receipt", "absent"];

export const CATEGORIES = ["fees", "receipts", "attendance", "classes", "welcome"] as const;
export type Category = (typeof CATEGORIES)[number];
export const TEMPLATE_CATEGORY: Record<TemplateKey, Category> = { fee_due: "fees", fee_overdue: "fees", receipt: "receipts", absent: "attendance", class_cancelled: "classes", welcome: "welcome" };

export const variablesIn = (body: string): string[] => [...new Set([...body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1] ?? ""))];

export const DEFAULT_TEMPLATES: Record<TemplateKey, Record<Language, string>> = {
  fee_due: {
    en: "Hello {{guardian_name}}, {{student_names}}'s fee of {{amount}} at {{academy}} is due on {{due_date}} ({{invoice_number}}). View or pay: {{link}} Thank you.",
    hi: "नमस्ते {{guardian_name}}, {{academy}} में {{student_names}} की फ़ीस {{amount}} {{due_date}} तक जमा करनी है ({{invoice_number}})। देखें या भुगतान करें: {{link}} धन्यवाद।",
    mr: "नमस्कार {{guardian_name}}, {{academy}} मधील {{student_names}} यांची फी {{amount}} {{due_date}} पर्यंत भरायची आहे ({{invoice_number}}). पाहा किंवा भरा: {{link}} धन्यवाद.",
  },
  fee_overdue: {
    en: "Hello {{guardian_name}}, {{student_names}}'s fee of {{amount}} at {{academy}} was due on {{due_date}} and is still unpaid ({{invoice_number}}). View or pay: {{link}} Thank you.",
    hi: "नमस्ते {{guardian_name}}, {{academy}} में {{student_names}} की फ़ीस {{amount}} {{due_date}} को देय थी और अभी बाकी है ({{invoice_number}})। देखें या भुगतान करें: {{link}} धन्यवाद।",
    mr: "नमस्कार {{guardian_name}}, {{academy}} मधील {{student_names}} यांची फी {{amount}} {{due_date}} रोजी देय होती आणि अजून बाकी आहे ({{invoice_number}}). पाहा किंवा भरा: {{link}} धन्यवाद.",
  },
  receipt: {
    en: "Hello {{guardian_name}}, {{academy}} received {{amount}} on {{date}}. Receipt {{receipt_number}}: {{link}} Thank you.",
    hi: "नमस्ते {{guardian_name}}, {{academy}} को {{date}} को {{amount}} प्राप्त हुए। रसीद {{receipt_number}}: {{link}} धन्यवाद।",
    mr: "नमस्कार {{guardian_name}}, {{academy}} ला {{date}} रोजी {{amount}} मिळाले. पावती {{receipt_number}}: {{link}} धन्यवाद.",
  },
  absent: {
    en: "Hello {{guardian_name}}, {{student_name}} was absent from {{batch}} at {{academy}} on {{date}}. Please let us know if anything is wrong.",
    hi: "नमस्ते {{guardian_name}}, {{student_name}} {{date}} को {{academy}} की {{batch}} कक्षा में नहीं आए। कोई समस्या हो तो कृपया हमें बताएं।",
    mr: "नमस्कार {{guardian_name}}, {{student_name}} {{date}} रोजी {{academy}} च्या {{batch}} वर्गाला आले नाहीत. काही अडचण असल्यास कृपया आम्हाला कळवा.",
  },
  class_cancelled: {
    en: "Hello {{guardian_name}}, {{student_name}}'s {{batch}} class at {{academy}} on {{date}} at {{time}} is cancelled. {{reason}}",
    hi: "नमस्ते {{guardian_name}}, {{academy}} में {{student_name}} की {{batch}} कक्षा {{date}} को {{time}} बजे नहीं होगी। {{reason}}",
    mr: "नमस्कार {{guardian_name}}, {{academy}} मधील {{student_name}} यांचा {{batch}} वर्ग {{date}} रोजी {{time}} वाजता होणार नाही. {{reason}}",
  },
  welcome: {
    en: "Welcome to {{academy}}, {{guardian_name}}! {{student_name}} has joined us. We're glad to have you.",
    hi: "{{academy}} में आपका स्वागत है, {{guardian_name}}! {{student_name}} हमारे साथ जुड़ गए हैं। आपका साथ पाकर हमें खुशी है।",
    mr: "{{academy}} मध्ये आपले स्वागत आहे, {{guardian_name}}! {{student_name}} आमच्यात सामील झाले आहेत. आपल्या सहभागाचा आम्हाला आनंद आहे.",
  },
};

// Meta wants numbered variables ({{1}}, {{2}}…) in an approved template: the
// text to paste into Meta, and which of ours each number carries. Meta refuses
// a template that starts or ends with a variable (`edge`).
export function toMetaTemplate(body: string): { text: string; names: string[]; edge: boolean } {
  const names = variablesIn(body);
  const text = body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name: string) => `{{${names.indexOf(name) + 1}}}`).trim();
  return { text, names, edge: /^\{\{|\}\}$/.test(text) };
}

// Fills {{name}} from vars; an unknown or empty one leaves no gap behind.
export function render(body: string, vars: Record<string, string>): string {
  return body
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name: string) => vars[name] ?? "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,।)])/g, "$1")
    .trim();
}

// "Riya", "Riya and Kabir", "Riya, Kabir and Zoya".
export function joinNames(names: string[]): string {
  return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
