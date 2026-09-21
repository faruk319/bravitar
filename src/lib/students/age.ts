// No date of birth means we treat the student as a minor (fail safe).
export function isMinor(dateOfBirth: string | Date | null | undefined, today = new Date()): boolean {
  if (!dateOfBirth) return true;
  const dob = typeof dateOfBirth === "string" ? new Date(`${dateOfBirth}T00:00:00Z`) : dateOfBirth;
  if (Number.isNaN(dob.getTime())) return true;
  const eighteenth = new Date(Date.UTC(dob.getUTCFullYear() + 18, dob.getUTCMonth(), dob.getUTCDate()));
  return today.getTime() < eighteenth.getTime();
}
