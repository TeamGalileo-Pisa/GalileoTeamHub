import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTH_EMAIL_DOMAIN,
  INITIAL_ACCOUNTS,
  usernameToInternalEmail,
} from "./initial-accounts.mjs";

const expectedAreas = [
  "Software",
  "Elettronica",
  "Braccio",
  "Rover",
  "Geologia",
  "Biologia",
  "Logistica",
  "Business",
  "Comunicazione",
];

describe("manifest degli account iniziali", () => {
  it("contiene un amministratore e nove capi area esatti", () => {
    expect(INITIAL_ACCOUNTS).toHaveLength(10);
    expect(INITIAL_ACCOUNTS[0]).toMatchObject({
      username: "Amministrazione",
      displayName: "Amministrazione",
      role: "admin",
    });
    expect(
      INITIAL_ACCOUNTS.slice(1).map((account) => account.area),
    ).toEqual(expectedAreas);
    expect(
      INITIAL_ACCOUNTS.slice(1).every(
        (account) =>
          account.role === "area_lead" && account.displayName === account.area,
      ),
    ).toBe(true);
  });

  it("usa variabili password univoche senza valori nel manifest", () => {
    const variables = INITIAL_ACCOUNTS.map(
      (account) => account.passwordEnvironmentVariable,
    );
    expect(new Set(variables).size).toBe(INITIAL_ACCOUNTS.length);
    expect(variables.every((name) => /^BOOTSTRAP_[A-Z]+_PASSWORD$/.test(name))).toBe(
      true,
    );
    expect(INITIAL_ACCOUNTS.every((account) => !("password" in account))).toBe(
      true,
    );
  });

  it("genera solo indirizzi Auth sintetici interni", () => {
    const emails = INITIAL_ACCOUNTS.map((account) =>
      usernameToInternalEmail(account.username, DEFAULT_AUTH_EMAIL_DOMAIN),
    );
    expect(emails).toHaveLength(new Set(emails).size);
    expect(emails.every((email) => email.endsWith("@auth.teamgalileo.local"))).toBe(
      true,
    );
    expect(emails).not.toContain("info.teamgalileo@gmail.com");
  });
});
