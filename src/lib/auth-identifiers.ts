const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,48}[a-z0-9]$/;

export function normalizeUsername(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "");
}

export function isValidUsername(value: string): boolean {
  return USERNAME_PATTERN.test(normalizeUsername(value));
}

export function usernameToAuthEmail(
  username: string,
  domain: string,
): string {
  const normalized = normalizeUsername(username);

  if (!USERNAME_PATTERN.test(normalized)) {
    throw new Error("Nome utente non valido");
  }

  return `${normalized}@${domain}`;
}

