export const DEFAULT_AUTH_EMAIL_DOMAIN = "auth.teamgalileo.local";

export const INITIAL_ACCOUNTS = Object.freeze([
  {
    username: "Amministrazione",
    displayName: "Amministrazione",
    role: "admin",
    passwordEnvironmentVariable: "BOOTSTRAP_ADMIN_PASSWORD",
  },
  {
    username: "Software",
    displayName: "Software",
    role: "area_lead",
    area: "Software",
    passwordEnvironmentVariable: "BOOTSTRAP_SOFTWARE_PASSWORD",
  },
  {
    username: "Elettronica",
    displayName: "Elettronica",
    role: "area_lead",
    area: "Elettronica",
    passwordEnvironmentVariable: "BOOTSTRAP_ELETTRONICA_PASSWORD",
  },
  {
    username: "Braccio",
    displayName: "Braccio",
    role: "area_lead",
    area: "Braccio",
    passwordEnvironmentVariable: "BOOTSTRAP_BRACCIO_PASSWORD",
  },
  {
    username: "Rover",
    displayName: "Rover",
    role: "area_lead",
    area: "Rover",
    passwordEnvironmentVariable: "BOOTSTRAP_ROVER_PASSWORD",
  },
  {
    username: "Geologia",
    displayName: "Geologia",
    role: "area_lead",
    area: "Geologia",
    passwordEnvironmentVariable: "BOOTSTRAP_GEOLOGIA_PASSWORD",
  },
  {
    username: "Biologia",
    displayName: "Biologia",
    role: "area_lead",
    area: "Biologia",
    passwordEnvironmentVariable: "BOOTSTRAP_BIOLOGIA_PASSWORD",
  },
  {
    username: "Logistica",
    displayName: "Logistica",
    role: "area_lead",
    area: "Logistica",
    passwordEnvironmentVariable: "BOOTSTRAP_LOGISTICA_PASSWORD",
  },
  {
    username: "Business",
    displayName: "Business",
    role: "area_lead",
    area: "Business",
    passwordEnvironmentVariable: "BOOTSTRAP_BUSINESS_PASSWORD",
  },
  {
    username: "Comunicazione",
    displayName: "Comunicazione",
    role: "area_lead",
    area: "Comunicazione",
    passwordEnvironmentVariable: "BOOTSTRAP_COMUNICAZIONE_PASSWORD",
  },
]);

export function normalizeUsername(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "");
}

export function usernameToInternalEmail(username, domain) {
  const normalizedUsername = normalizeUsername(username);
  const normalizedDomain = domain.trim().toLowerCase();

  if (!/^[a-z0-9][a-z0-9._-]{1,48}[a-z0-9]$/.test(normalizedUsername)) {
    throw new Error(`Username non valido nel manifest: ${username}`);
  }
  if (!/^[a-z0-9.-]+$/.test(normalizedDomain) || !normalizedDomain.includes(".")) {
    throw new Error("Dominio Auth interno non valido");
  }

  const email = `${normalizedUsername}@${normalizedDomain}`;
  if (email === "info.teamgalileo@gmail.com") {
    throw new Error("L'indirizzo mittente non può essere usato per Auth");
  }

  return email;
}
