import { describe, expect, it } from "vitest";
import { csvCell, inventoryErrorMessage, skuPrefix, stockState, validateLocationCode, type InventorySettings } from "./inventory";

const limits: InventorySettings = { shelf_max_letter: "F", level_max: 5, slot_letters: "BR", slot_max: 20 };

describe("magazzino", () => {
  it("calcola lo stato scorta: RIORDINARE se la quantità è minore o uguale alla scorta minima", () => {
    expect(stockState(10, 5)).toBe("OK");
    expect(stockState(5, 5)).toBe("RIORDINARE");
    expect(stockState(0, 0)).toBe("RIORDINARE");
    expect(stockState(2, 5)).toBe("RIORDINARE");
  });

  it("anticipa il prefisso dello SKU da area e sottoteam", () => {
    expect(skuPrefix("tecnica", "Motore")).toBe("MEC-MOT");
    expect(skuPrefix("analisi", "Biologia")).toBe("SCI-BIO");
  });

  it("valida il formato e i limiti del codice posizione", () => {
    expect(validateLocationCode("A-01-B01", limits)).toBeNull();
    expect(validateLocationCode("c-02-r05", limits)).toBeNull();
    expect(validateLocationCode("A-1-B01", limits)).toMatch(/formato/i);
    expect(validateLocationCode("AA-01-B01", limits)).toMatch(/formato/i);
    expect(validateLocationCode("G-01-B01", limits)).toMatch(/scaffale/i);
    expect(validateLocationCode("A-06-B01", limits)).toMatch(/ripiano/i);
    expect(validateLocationCode("A-00-B01", limits)).toMatch(/ripiano/i);
    expect(validateLocationCode("A-01-C01", limits)).toMatch(/box/i);
    expect(validateLocationCode("A-01-B21", limits)).toMatch(/box/i);
  });

  it("traduce i codici d'errore del database", () => {
    expect(inventoryErrorMessage(new Error("RETURN_EXCEEDS_LOAN"))).toMatch(/prestito/);
    expect(inventoryErrorMessage({ message: 'duplicate key value violates unique constraint "inventory_items_sku_unique"' })).toMatch(/SKU/);
    expect(inventoryErrorMessage(new Error("qualcosa di nuovo"))).toBe("qualcosa di nuovo");
  });

  it("protegge i CSV da formule e virgolette", () => {
    expect(csvCell("=SOMMA(A1)")).toBe("\"'=SOMMA(A1)\"");
    expect(csvCell('a "b"')).toBe('"a ""b"""');
  });
});
