// docs/03 §4 (agreed 2026-09-25): the board's stages, where enquiries come
// from, and why they are lost. No database here, so screens can use it too.

export const ENQUIRY_STATUSES = ["new", "contacted", "trial_booked", "trial_done", "won", "lost"] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];
export const STATUS_LABELS: Record<EnquiryStatus, string> = { new: "New", contacted: "Contacted", trial_booked: "Trial booked", trial_done: "Trial done", won: "Won", lost: "Lost" };
export const OPEN_STATUSES: readonly EnquiryStatus[] = ["new", "contacted", "trial_booked", "trial_done"];

export const SOURCES = ["walk_in", "phone_call", "whatsapp", "referral", "instagram", "facebook", "google", "poster", "other"] as const;
export type Source = (typeof SOURCES)[number];
export const SOURCE_LABELS: Record<Source, string> = {
  walk_in: "Walk-in",
  phone_call: "Phone call",
  whatsapp: "WhatsApp",
  referral: "Referral",
  instagram: "Instagram",
  facebook: "Facebook",
  google: "Google",
  poster: "Poster/banner",
  other: "Other",
};

export const LOST_REASONS = ["fees", "timing", "distance", "elsewhere", "not_interested", "no_reply", "other"] as const;
export type LostReason = (typeof LOST_REASONS)[number];
export const LOST_REASON_LABELS: Record<LostReason, string> = {
  fees: "Fees too high",
  timing: "Timing doesn't suit",
  distance: "Too far",
  elsewhere: "Joined elsewhere",
  not_interested: "Not interested now",
  no_reply: "No reply",
  other: "Other",
};

export const ACTIVITY_KINDS = ["call", "whatsapp", "visit", "note", "status_change"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export const ACTIVITY_LABELS: Record<ActivityKind, string> = { call: "Call", whatsapp: "WhatsApp", visit: "Visit", note: "Note", status_change: "Status" };
