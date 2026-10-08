import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StudentProfile } from "@/modules/students/profile";
import type { StudentEnrollment } from "@/modules/enrollments/repo";
import type { FamilyMember } from "@/modules/students/repo";
import type { Student } from "@/modules/students/schema";

// Client-only pieces (server actions, router) are not what is under test.
vi.mock("@/components/students/student-actions", () => ({ PhotoConsentToggle: () => null, StatusActions: () => null }));
vi.mock("@/components/students/family", () => ({ AddFamilyMember: () => null, FamilyMemberActions: () => null }));
vi.mock("@/components/students/whatsapp-optin", () => ({ WhatsappOptin: () => null }));
vi.mock("@/components/messaging/composer", () => ({ Composer: () => null }));
vi.mock("next/link", () => ({ default: ({ children }: { children: unknown }) => children }));

const { EnrollmentCard, GuardianCard, PersonalCard } = await import("./overview-cards");

const when = new Date("2026-09-01T00:00:00Z");
const student: Student = { id: "s1", tenantId: "t1", branchId: "b1", code: "ST/2026/0001", codeEditedAt: null, fullName: "Adult Member", dateOfBirth: null, gender: null, phone: null, address: null, photoKey: null, status: "active", joinedOn: "2026-09-01", leftOn: null, leftReason: null, leftNote: null, metadata: {}, createdAt: when, updatedAt: when, deletedAt: null };
const father: FamilyMember = { id: "g1", tenantId: "t1", fullName: "Salim", phone: "+919000000001", email: "salim@x.test", canLogin: true, isPrimary: true, whatsappOptin: false, whatsappOptinAt: null, address: null, notes: null, createdAt: when, deletedAt: null, relation: "father", isManager: true };
const alone: StudentProfile = { student, guardians: [], siblings: [], consents: {}, batches: { current: [], past: [] }, nextDue: null };
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);

describe("overview cards", () => {
  it("render for a student with no guardian", () => {
    expect(html(createElement(PersonalCard, { o: alone, canUpdate: true }))).toContain("Email");
    expect(html(createElement(GuardianCard, { o: alone, canUpdate: true, canMessage: true }))).toContain("No guardian");
    const e = html(createElement(EnrollmentCard, { o: alone, canUpdate: true, due: [] }));
    expect(e).toContain("Not in a batch yet");
    expect(e).toContain("Active");
  });

  it("show each guardian's email, labelled, and Paused for a paused student", () => {
    const o: StudentProfile = { ...alone, student: { ...student, status: "paused" }, guardians: [father] };
    expect(html(createElement(PersonalCard, { o, canUpdate: false }))).toContain("Email (father)");
    expect(html(createElement(EnrollmentCard, { o, canUpdate: false, due: [] }))).toContain("Paused");
    expect(html(createElement(GuardianCard, { o, canUpdate: false, canMessage: false }))).toContain("Manager");
  });
});

describe("current program card", () => {
  const enrollment: StudentEnrollment = {
    id: "e1", tenantId: "t1", studentId: "s1", batchId: "b1", status: "active", startDate: "2026-09-01", endDate: null, pausedOn: null, transferredToEnrollmentId: null, feePlanId: null,
    payerGuardianId: null, payerMemberId: null, createdAt: when, batchName: "Karate A", programName: "Karate", nextBatchName: null, planName: null, coachName: "Coach Rao",
  };
  const placed: StudentProfile = { ...alone, batches: { current: [enrollment], past: [] } };

  it("shows program, batch and coach, and no progress or level", () => {
    const out = html(createElement(EnrollmentCard, { o: placed, canUpdate: false, due: [] })).replace(/<[^>]*>/g, " ");
    for (const w of ["Karate", "Karate A", "Coach Rao"]) expect(out).toContain(w);
    expect(out).not.toMatch(/progress|level|%/i);
  });

  it("an unplaced student has no program rows, only a note", () => {
    const out = html(createElement(EnrollmentCard, { o: alone, canUpdate: false, due: [] }));
    expect(out).toContain("Not in a batch yet");
    expect(out).not.toContain("Coach");
  });
});
