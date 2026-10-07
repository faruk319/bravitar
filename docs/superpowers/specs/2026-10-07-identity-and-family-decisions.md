# Identity, family and student self-access — decisions

Date: 2026-10-07
Status: decisions taken by the user; **not yet specced into tasks**
Supersedes nothing; extends the family model shipped 2026-10-03 (`d749c24`, `e80a6f8`)

This records what was agreed in conversation so it does not drift. The
implementation spec and plan come later — this is the decision record.

## What already exists

Most of the plumbing is built. These decisions are policy on top of it.

| Concept | Where it lives |
|---|---|
| Family unit | `app.households` (holds the address) |
| A person who can sign in | `app.guardians` — `phone`, `email`, `can_login`, `is_primary` |
| Family manager | `app.student_guardians.is_manager`, one per student (migration 0037) |
| Access ended without deleting history | `app.student_guardians.removed_at` |
| What relatives may see | `app.tenants.family_access` (migration 0038) |
| An adult student as their own account | the `self` relation in `src/modules/students/relations.ts` |

**Sign-in resolves phone → guardian, never phone → student.** Students have a
`phone` column, but it is not a login identity. A student signs in only by
having a `guardians` row of their own, linked to their student record with
relation `self`. That mechanism already works for adult students today.

## Decisions

### 1. Everyone has their own profile

Adding a parent's number to a child creates **two accounts**: the parent's and
the child's. Each person's profile holds their own data.

The **link** between them — manager, or family access — is what grants
cross-visibility. It is not what creates the account.

### 2. Severing the link cuts visibility both ways

When either the child or the parent removes the manager link or family access,
**neither can see the other's data** any more. Each keeps their own profile and
their own history intact.

This is symmetric on purpose: a parent cannot keep watching a child who has
separated, and a child cannot keep visibility of a parent's record.

### 3. Age threshold for a student's own login

- **Default 18**, matching India's DPDP Act 2023, which defines a child as
  under 18 and requires verifiable parental consent for processing their data.
- The **academy owner may change it**, but **not below 13**. 13 is a hard floor
  in code, not a suggestion.
- The setting carries an **ⓘ info control giving the owner the legal
  information**, so the choice is informed. Keep the on-screen text short; the
  detail belongs behind the ⓘ.

Below the threshold, the parent manages everything and the student has no
login. At or above it, the student may be given their own `self` account with
their own phone.

**Open — not decided:** whether reaching the threshold triggers anything
automatically, or whether it only *permits* staff/parent to create the account.
Default assumption until the user says otherwise: it permits, never automatic.

### 4. Leaving the family

The student raises the request from the portal. The **family manager or the
academy owner** performs the removal. Setting `removed_at` ends access while
attendance, invoices and receipts remain for the academy's records.

## Open questions for the implementation spec

These were not settled and must not be guessed:

1. Who pays after a separation? The invoice is raised against the **household**,
   so a student leaving a household needs somewhere for future invoices to go.
2. Does a student leaving a household keep their fee and attendance history on
   their own profile, or does it stay with the household that paid for it?
3. What happens when the departing student is the household's **only** member?
4. Does changing the academy's age threshold affect students who already have
   logins under the old threshold? (Almost certainly it must not revoke them.)
5. Does the student's own account need an **email**, or is phone plus WhatsApp
   code enough? The portal signs in by phone today; email may be unnecessary.

## Relationship to other work

The students-pages redesign does **not** depend on this. Until it lands, the
Personal Information card shows the guardian's email and the household address,
labelled so it is clear whose they are. Once students have their own profiles,
it shows their own.
