// Scheda di valutazione CFU: criteri, punteggi e giudizio finale.

export const CFU_LEVELS = [
  { id: "ottimo", label: "Ottimo", points: 4 },
  { id: "discreto", label: "Discreto", points: 3 },
  { id: "buono", label: "Buono", points: 2 },
  { id: "sufficiente", label: "Sufficiente", points: 1 },
  { id: "insufficiente", label: "Insufficiente", points: 0 },
] as const;

export type CfuLevelId = (typeof CFU_LEVELS)[number]["id"];

export const CFU_CRITERIA = [
  { id: "competenza", label: "Competenza e rigore tecnico-scientifico/analitico" },
  { id: "autonomia", label: "Autonomia operativa e rispetto delle scadenze" },
  { id: "problem_solving", label: "Problem solving e gestione degli imprevisti" },
  { id: "costanza", label: "Costanza, presenza e gestione del tempo" },
  { id: "teamwork", label: "Capacità di lavoro in team multidisciplinare" },
  { id: "comunicazione", label: "Comunicazione, proattività e spirito d'iniziativa" },
  { id: "sicurezza", label: "Rispetto delle norme di sicurezza e regolamenti" },
  { id: "documentazione", label: "Qualità della documentazione e dei report" },
] as const;

export type CfuCriterionId = (typeof CFU_CRITERIA)[number]["id"];
export type CfuRatings = Partial<Record<CfuCriterionId, CfuLevelId>>;

export const CFU_PASS_SCORE = 18;
export const CFU_MAX_SCORE = CFU_CRITERIA.length * 4;

export function levelPoints(level: CfuLevelId | undefined): number {
  return CFU_LEVELS.find((entry) => entry.id === level)?.points ?? 0;
}

export function normalizeRatings(value: unknown): CfuRatings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const ratings: CfuRatings = {};
  for (const criterion of CFU_CRITERIA) {
    const level = source[criterion.id];
    if (CFU_LEVELS.some((entry) => entry.id === level)) ratings[criterion.id] = level as CfuLevelId;
  }
  return ratings;
}

export function cfuScore(ratings: CfuRatings): number {
  return CFU_CRITERIA.reduce((sum, criterion) => sum + levelPoints(ratings[criterion.id]), 0);
}

export const isCfuComplete = (ratings: CfuRatings) => CFU_CRITERIA.every((criterion) => Boolean(ratings[criterion.id]));

/** Favorevole se il punteggio totale è almeno 18, altrimenti contrario. */
export const cfuVerdict = (score: number): "favorevole" | "contrario" => (score >= CFU_PASS_SCORE ? "favorevole" : "contrario");

/** Valutazione finale in trentesimi: il punteggio stesso, e oltre 30 si scrive 30LODE. */
export const cfuFinalGrade = (score: number): string => `${score > 30 ? "30LODE" : score}/30`;

export interface CfuMember {
  id: string;
  first_name: string;
  last_name: string;
  student_number: string;
  degree: string;
  department: string;
  area_id: string | null;
  division: string;
  team_role: string;
  period_from: string | null;
  period_to: string | null;
  description: string;
  ratings: CfuRatings;
  evaluated_at: string | null;
}

export interface CfuLeadMember {
  id: string;
  first_name: string;
  last_name: string;
  description: string;
  ratings: CfuRatings;
  evaluated_at: string | null;
}

export function cfuErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : "";
  if (text.includes("CFU_FORBIDDEN")) return "Non hai i permessi per questa operazione.";
  if (text.includes("CFU_CLOSED")) return "La compilazione CFU non è attiva per la tua area.";
  if (text.includes("CFU_NOT_FOUND")) return "Membro non trovato.";
  if (text.includes("CFU_INVALID")) return "Dati non validi.";
  return text || "Operazione non riuscita.";
}
