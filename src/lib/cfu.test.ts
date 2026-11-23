import { describe, expect, it } from "vitest";
import { CFU_CRITERIA, CFU_MAX_SCORE, cfuFinalGrade, cfuScore, cfuVerdict, isCfuComplete, levelPoints, normalizeRatings, type CfuRatings } from "./cfu";

const all = (level: CfuRatings[keyof CfuRatings]): CfuRatings => Object.fromEntries(CFU_CRITERIA.map((c) => [c.id, level]));

describe("punteggi CFU", () => {
  it("assegna i punti richiesti ai livelli", () => {
    expect(["insufficiente", "sufficiente", "buono", "discreto", "ottimo"].map((l) => levelPoints(l as never))).toEqual([0, 1, 2, 3, 4]);
  });

  it("somma i punti dei criteri", () => {
    expect(cfuScore({ competenza: "ottimo", autonomia: "buono", costanza: "insufficiente" })).toBe(6);
    expect(cfuScore(all("ottimo"))).toBe(CFU_MAX_SCORE);
    expect(CFU_MAX_SCORE).toBe(64);
  });

  it("è favorevole da 18 punti in su, contrario sotto", () => {
    expect(cfuVerdict(36)).toBe("favorevole");
    expect(cfuVerdict(64)).toBe("favorevole");
    expect(cfuVerdict(35)).toBe("contrario");
    expect(cfuVerdict(0)).toBe("contrario");
  });

  it("riconosce una scheda completa e ignora valori non validi", () => {
    expect(isCfuComplete(all("buono"))).toBe(true);
    expect(isCfuComplete({ competenza: "buono" })).toBe(false);
    expect(normalizeRatings({ competenza: "ottimo", autonomia: "boh", altro: "buono" })).toEqual({ competenza: "ottimo" });
    expect(normalizeRatings(null)).toEqual({});
  });

  it("valutazione finale in trentesimi, con lode oltre il 30", () => {
    expect(cfuFinalGrade(36)).toBe("18/30");
    expect(cfuFinalGrade(60)).toBe("30/30");
    expect(cfuFinalGrade(62)).toBe("30LODE/30");
    expect(cfuFinalGrade(64)).toBe("30LODE/30");
    expect(cfuFinalGrade(24)).toBe("12/30");
  });
});
