# One person, several academies and roles — decisions

Date: 2026-10-08 · Status: **decisions taken, not yet specced into tasks**
Extends: `2026-10-07-identity-and-family-decisions.md`, `2026-10-08-onboarding-decisions.md`

## What already exists, and is right

Identity is **per tenant**. A person who deals with two academies has two rows.
Authentication links them; the data never does.

| Channel | Identity row | Cross-academy today |
|---|---|---|
| phone + WhatsApp code | `guardians` (unique per tenant + phone) | linked at sign-in |
| email + password | `staff_users` | `findActiveStaffByEmail` tried per tenant |

`app.login_handoffs` carries `linkedTenants uuid[]` — "the academies this sign-in
also proved" — and issues one-time tokens to switch origin without signing in
again. The seed already exercises it: phone `98765 00001` is a parent at two
academies.

This is the Slack model (same email, separate account per workspace, one
sign-in). **It is the best practice for an RLS-isolated multi-tenant product and
should not be replaced.**

### Why there is no global `people` table, and must not be

- **It contradicts rule 1** ("tenants must never see each other's data"). A
  shared person row is a cross-tenant join path by construction and would have to
  live outside RLS — the same category as the `service_role` key that is banned
  from application code.
- **It leaks between customers.** One person edits their name at academy A and
  academy B's records change; two academies learn they share a parent. Neither
  consented.
- **It buys nothing.** The handoff already gives one sign-in across academies.

## Decisions, 2026-10-08

### 1. A dual-role person gets one sign-in and a switcher

A coach whose own child attends the same academy currently has a `staff_users`
row (email) **and** a `guardians` row (phone): two login paths, nothing linking
them, two sign-ins to see their own child.

Whichever channel they use, sign-in finds **both** rows and offers a switcher —
the same pattern as the existing staff academy switcher (`f3b4e43`).

**Two rows stay in the database.** Permissions, audit and history stay clean, and
nothing merges the staff and guardian permission models. The link is presentation
and session, not schema.

### 2. Sign-in searches both channels and links what is verified

Today a phone sign-in looks only for guardians and an email sign-in only for
staff, so a parent at academy A who is staff at academy B gets no link at all.

A verified **phone** must also find `staff_users` rows carrying that phone; a
verified **email** must also find guardian rows carrying that email.

**The linkage stays computed at sign-in and is never stored cross-tenant.** It
lives in `login_handoffs.linkedTenants`, which is already exactly this. Only an
**active** row in a tenant may be linked, and each academy's own failure limit
still applies before its name is revealed (the behaviour at `auth/service.ts:121`).

### 3. Profile data stays per academy

A parent's name and phone are stored separately at each academy and do not
propagate. Each academy keeps its own record of the people it deals with, which
is also what data-protection expectations assume. A correction at one academy
must not silently rewrite another's records.

Supersedes nothing; it makes the current behaviour deliberate rather than
incidental.

## Consequences to handle when this is specced

- **Verification is per channel, not per tenant.** A phone proven at academy A is
  proven; what differs is which rows it may open. Keep the per-academy failure
  limits.
- **A linked row that is deactivated** must drop out of the switcher immediately.
  Leaving an academy must remove it from the list, not merely hide it.
- **`staff_users.phone` is nullable and is not a login identity today.** Decision 2
  makes it a *matching* key. It must therefore be verified before it can link
  anything, or it becomes a way to claim someone else's accounts by typing their
  number into a staff profile. **This is the security-critical part of this spec.**
- **One phone owning several academies** (an owner of two academies) is the same
  mechanism and needs no special case — but see the sign-up sub-spec for whether
  it is allowed at all.
- [[rbac-owner-editable]] is unaffected: roles stay per tenant, and a person's
  permissions at academy A say nothing about academy B.
