import { describe, expect, it } from "vitest";
import { answerFor, buildColumns, formatAnswer, summarizeColumn, type FormQuestion, type FormResponse, type SnapshotQuestion } from "./business-forms";

const sq = (over: Partial<SnapshotQuestion>): SnapshotQuestion => ({ id: "q", label: "D", kind: "short_text", options: [], ...over });
const r = (id: string, name: string, questions: SnapshotQuestion[], answers: Record<string, unknown>, at = "2026-11-12T10:00:00Z"): FormResponse => ({
  id, form_id: "f", respondent_id: id, respondent_name: name, respondent_username: name, area_names: "", questions, answers, created_at: at,
});
const column = (q: SnapshotQuestion, rs: FormResponse[]) => buildColumns(rs).find((c) => c.id === q.id && c.label === q.label)!;

describe("business forms", () => {
  it("riassume le scelte con conteggi e percentuali", () => {
    const q = sq({ id: "a", kind: "single_choice", options: ["In linea", "In ritardo"] });
    const rs = [r("1", "A", [q], { a: "In linea" }), r("2", "B", [q], { a: "In linea" }), r("3", "C", [q], { a: "In ritardo" })];
    const summary = summarizeColumn(column(q, rs), rs);
    expect(summary).toMatchObject({ kind: "choice", answered: 3 });
    if (summary.kind === "choice") expect(summary.counts).toEqual([{ option: "In linea", count: 2, percent: 67 }, { option: "In ritardo", count: 1, percent: 33 }]);
  });

  it("calcola media, minimo e massimo per le valutazioni", () => {
    const q = sq({ id: "a", kind: "rating" });
    const rs = [r("1", "A", [q], { a: 5 }), r("2", "B", [q], { a: 2 }), r("3", "C", [q], {})];
    expect(summarizeColumn(column(q, rs), rs)).toMatchObject({ kind: "number", answered: 2, average: 3.5, min: 2, max: 5 });
  });

  it("elenca i testi dal più recente con il nome di chi ha risposto", () => {
    const q = sq({ id: "a" });
    const rs = [r("1", "Anna", [q], { a: "uno" }, "2026-11-01T10:00:00Z"), r("2", "Bruno", [q], { a: "due" }, "2026-11-05T10:00:00Z")];
    const summary = summarizeColumn(column(q, rs), rs);
    if (summary.kind === "text") expect(summary.entries.map((e) => e.name)).toEqual(["Bruno", "Anna"]);
  });

  it("le domande possono cambiare tra le compilazioni: testo modificato e domande aggiunte restano separate", () => {
    const old = sq({ id: "a", label: "Come va l'area?" });
    const renamed = sq({ id: "a", label: "Come procede l'area questo mese?" });
    const added = sq({ id: "b", label: "Novità del mese" });
    const rs = [
      r("1", "Anna", [old], { a: "Bene" }, "2026-10-01T10:00:00Z"),
      r("2", "Bruno", [renamed, added], { a: "Meglio", b: "Nuovo sponsor" }, "2026-11-01T10:00:00Z"),
    ];
    const current: FormQuestion[] = [
      { id: "a", label: renamed.label, help: "", kind: "short_text", options: [], required: false },
      { id: "b", label: added.label, help: "", kind: "short_text", options: [], required: false },
    ];
    const columns = buildColumns(rs, current);
    expect(columns.map((c) => c.label)).toEqual([old.label, renamed.label, added.label]);
    expect(columns.map((c) => c.current)).toEqual([false, true, true]);
    expect(answerFor(columns[0], rs[0])).toBe("Bene");
    expect(answerFor(columns[0], rs[1])).toBeUndefined();
    expect(answerFor(columns[2], rs[0])).toBeUndefined();
    expect(answerFor(columns[2], rs[1])).toBe("Nuovo sponsor");
    const summary = summarizeColumn(columns[2], rs);
    expect(summary.answered).toBe(1);
  });

  it("unisce le opzioni quando vengono aggiunte in un secondo momento", () => {
    const v1 = sq({ id: "a", kind: "multiple_choice", options: ["Budget"] });
    const v2 = sq({ id: "a", kind: "multiple_choice", options: ["Budget", "Persone"] });
    const rs = [r("1", "A", [v1], { a: ["Budget"] }, "2026-10-01T10:00:00Z"), r("2", "B", [v2], { a: ["Persone", "Budget"] }, "2026-11-01T10:00:00Z")];
    const summary = summarizeColumn(buildColumns(rs)[0], rs);
    if (summary.kind === "choice") expect(summary.counts.map((c) => `${c.option}:${c.count}`)).toEqual(["Budget:2", "Persone:1"]);
  });

  it("formatta sì/no, liste, valutazioni e date", () => {
    expect(formatAnswer({ kind: "yes_no" }, true)).toBe("Sì");
    expect(formatAnswer({ kind: "multiple_choice" }, ["A", "B"])).toBe("A; B");
    expect(formatAnswer({ kind: "rating" }, 4)).toBe("4 / 5");
    expect(formatAnswer({ kind: "date" }, "2026-11-12")).toBe("12/11/2026");
  });
});
