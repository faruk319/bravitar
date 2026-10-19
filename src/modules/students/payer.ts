export type Payer = { kind: "guardian"; guardianId: string } | { kind: "member"; memberId: string };

// Both set is a corrupt row (the DB CHECK forbids it): throw rather than guess who owes money.
export function payerOf(row: { payerGuardianId: string | null; payerMemberId: string | null }): Payer | null {
  if (row.payerGuardianId && row.payerMemberId) throw new Error("payer row has both a guardian and a member");
  if (row.payerGuardianId) return { kind: "guardian", guardianId: row.payerGuardianId };
  if (row.payerMemberId) return { kind: "member", memberId: row.payerMemberId };
  return null;
}

// Who pays for an enrollment: its own payer; with none, the member's lead guardian, else the member themselves.
// Billing and the collect screen both ask here. A row with both payer columns set throws (payerOf); callers skip it.
export function planPayer(e: { studentId: string; payerGuardianId: string | null; payerMemberId: string | null }, leadGuardianId: string | undefined): Payer {
  return payerOf(e) ?? (leadGuardianId ? { kind: "guardian", guardianId: leadGuardianId } : { kind: "member", memberId: e.studentId });
}

// Kind-prefixed, so a guardian and a member with the same id never share a key.
export function payerKey(p: Payer): string {
  return p.kind === "guardian" ? `guardian:${p.guardianId}` : `member:${p.memberId}`;
}
