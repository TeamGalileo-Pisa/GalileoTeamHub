import {
  isValidUsername,
  normalizeUsername,
  usernameToAuthEmail,
} from "./auth-identifiers";

describe("auth identifiers", () => {
  it("normalizza nomi area in identificativi stabili", () => {
    expect(normalizeUsername("  Elettronica  ")).toBe("elettronica");
    expect(normalizeUsername("Amministrazione Generale")).toBe(
      "amministrazione-generale",
    );
  });

  it("rifiuta identificativi troppo corti", () => {
    expect(isValidUsername("a")).toBe(false);
  });

  it("costruisce l'email Auth interna senza esporla all'utente", () => {
    expect(
      usernameToAuthEmail("Software", "auth.teamgalileo.local"),
    ).toBe("software@auth.teamgalileo.local");
  });
});
