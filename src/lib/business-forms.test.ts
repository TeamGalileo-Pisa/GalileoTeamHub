import { describe, expect, it } from "vitest";
import { formatAnswer, questionsWithAnswers, summarizeQuestion, type FormQuestion, type FormResponse } from "./business-forms";

const q = (over: Partial<FormQuestion>): FormQuestion => ({ id: "q", label: "D", help: "", kind: "short_text", options: [], required: false, ...over });
const r = (id: string, name: string, answers: Record<string, unknown>, at = "2026-11-12T10:00:00Z"): FormResponse => ({
  id, form_id: "f", respondent_id: id, respondent_name: name, respondent_username: name, area_names: "", answers, created_at: at,
});

describe("business forms", () => {
  it("riassume le scelte con conteggi e percentuali", () => {
    const summary = summarizeQuestion(q({ id: "a", kind: "single_choice", options: ["In linea", "In ritardo"] }), [r("1", "A", { a: "In linea" }), r("2", "B", { a: "In linea" }), r("3", "C", { a: "In ritardo" })]);
    expect(summary).toMatchObject({ kind: "choice", answered: 3 });
    if (summary.kind === "choice") expect(summary.counts).toEqual([{ option: "In linea", count: 2, percent: 67 }, { option: "In ritardo", count: 1, percent: 33 }]);
  });

  it("conta le scelte multiple su ogni opzione", () => {
    const summary = summarizeQuestion(q({ id: "a", kind: "multiple_choice", options: ["Budget", "Persone"] }), [r("1", "A", { a: ["Budget", "Persone"] }), r("2", "B", { a: ["Budget"] })]);
    if (summary.kind === "choice") expect(summary.counts.map((c) => c.count)).toEqual([2, 1]);
  });

  it("calcola media, minimo e massimo per le valutazioni", () => {
    const summary = summarizeQuestion(q({ id: "a", kind: "rating" }), [r("1", "A", { a: 5 }), r("2", "B", { a: 2 }), r("3", "C", {})]);
    expect(summary).toMatchObject({ kind: "number", answered: 2, average: 3.5, min: 2, max: 5 });
  });

  it("elenca i testi dal più recente con il nome di chi ha risposto", () => {
    const summary = summarizeQuestion(q({ id: "a" }), [r("1", "Anna", { a: "uno" }, "2026-11-01T10:00:00Z"), r("2", "Bruno", { a: "due" }, "2026-11-05T10:00:00Z")]);
    if (summary.kind === "text") expect(summary.entries.map((e) => e.name)).toEqual(["Bruno", "Anna"]);
  });

  it("formatta sì/no, liste, valutazioni e date", () => {
    expect(formatAnswer({ kind: "yes_no" }, true)).toBe("Sì");
    expect(formatAnswer({ kind: "multiple_choice" }, ["A", "B"])).toBe("A; B");
    expect(formatAnswer({ kind: "rating" }, 4)).toBe("4 / 5");
    expect(formatAnswer({ kind: "date" }, "2026-11-12")).toBe("12/11/2026");
  });

  it("mantiene le domande archiviate solo se hanno risposte", () => {
    const archivedUsed = q({ id: "x", archived_at: "2026-11-10" });
    const archivedEmpty = q({ id: "y", archived_at: "2026-11-10" });
    const kept = questionsWithAnswers([archivedUsed, archivedEmpty, q({ id: "z" })], [r("1", "A", { x: "ciao" })]);
    expect(kept.map((item) => item.id)).toEqual(["x", "z"]);
  });
});
