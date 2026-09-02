// Shared pure validation: no credentials or runtime dependencies.
export const STUDENT_EMAIL_PATTERN = /^[^@\s]+@studenti\.unipi\.it$/;
export const STUDENT_EMAIL_MESSAGE =
  "Per prenotare il colloquio devi utilizzare la tua email universitaria @studenti.unipi.it.";

export function normalizeBookingFields(input: Record<string, unknown>) {
  const text = (key: string) =>
    typeof input[key] === "string" ? input[key].trim() : "";
  return {
    slotId: text("slotId"),
    firstName: text("firstName"),
    lastName: text("lastName"),
    email: text("email").toLowerCase(),
  };
}

export function validateBookingFields(
  input: Record<string, unknown>,
): string | null {
  const value = normalizeBookingFields(input);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value.slotId,
    )
  )
    return "INVALID_SLOT";
  if (
    value.firstName.length < 2 ||
    value.firstName.length > 80 ||
    value.lastName.length < 2 ||
    value.lastName.length > 80
  )
    return "INVALID_CANDIDATE_NAME";
  if (value.email.length > 254 || !STUDENT_EMAIL_PATTERN.test(value.email))
    return "INVALID_STUDENT_EMAIL";
  return null;
}
