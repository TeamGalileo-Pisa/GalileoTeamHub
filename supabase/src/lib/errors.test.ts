import { describe, expect, it } from "vitest";
import { toItalianErrorMessage } from "./errors";

describe("toItalianErrorMessage", () => {
  it("traduce gli errori di capacità", () => {
    expect(toItalianErrorMessage({ message: "ROOM_CAPACITY_EXCEEDED" })).toContain(
      "numero massimo",
    );
  });

  it("traduce gli errori di autorizzazione", () => {
    expect(toItalianErrorMessage({ code: "P0001", message: "FORBIDDEN" })).toBe(
      "Non hai i permessi per eseguire questa operazione.",
    );
  });

  it("non espone messaggi SQL sconosciuti", () => {
    const result = toItalianErrorMessage(
      'duplicate key value violates unique constraint "secret_table_key"',
    );
    expect(result).not.toContain("duplicate key");
    expect(result).not.toContain("secret_table_key");
  });
});
