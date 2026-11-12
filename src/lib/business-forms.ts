export type QuestionKind = "short_text" | "long_text" | "single_choice" | "multiple_choice" | "yes_no" | "number" | "rating" | "date";

export interface FormQuestion {
  id: string;
  form_id?: string;
  position?: number;
  label: string;
  help: string;
  kind: QuestionKind;
  options: string[];
  required: boolean;
  archived_at?: string | null;
}

export interface BusinessForm {
  id: string;
  title: string;
  description: string;
  is_open: boolean;
  share_token: string;
  created_at: string;
  updated_at: string;
}

export interface FormResponse {
  id: string;
  form_id: string;
  respondent_id: string | null;
  respondent_name: string;
  respondent_username: string;
  area_names: string;
  answers: Record<string, unknown>;
  created_at: string;
}

export const KIND_LABELS: Record<QuestionKind, string> = {
  short_text: "Risposta breve",
  long_text: "Risposta lunga",
  single_choice: "Scelta singola",
  multiple_choice: "Scelta multipla",
  yes_no: "Sì / No",
  number: "Numero",
  rating: "Valutazione 1–5",
  date: "Data",
};

export const hasOptions = (kind: QuestionKind) => kind === "single_choice" || kind === "multiple_choice";

export const publicFormLink = (token: string, origin = window.location.origin) => `${origin}/form/${token}`;

/** Testo leggibile di una risposta (usato nelle schede e nell'Excel). */
export function formatAnswer(question: Pick<FormQuestion, "kind">, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "Sì" : "No";
  if (Array.isArray(value)) return value.map(String).join("; ");
  if (question.kind === "rating") return `${value} / 5`;
  if (question.kind === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d}/${m}/${y}`;
  }
  return String(value);
}

export const isEmptyAnswer = (value: unknown) =>
  value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);

export interface ChoiceCount { option: string; count: number; percent: number }
export type QuestionSummary =
  | { kind: "choice"; answered: number; counts: ChoiceCount[] }
  | { kind: "number"; answered: number; average: number; min: number; max: number; counts?: ChoiceCount[] }
  | { kind: "text"; answered: number; entries: { name: string; text: string; at: string }[] };

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Riepilogo "intelligente" di una domanda: distribuzione per le scelte, media/min/max per i numeri, elenco per i testi. */
export function summarizeQuestion(question: FormQuestion, responses: FormResponse[]): QuestionSummary {
  const given = responses
    .map((response) => ({ response, value: response.answers?.[question.id] }))
    .filter((entry) => !isEmptyAnswer(entry.value));
  const answered = given.length;

  if (question.kind === "single_choice" || question.kind === "multiple_choice" || question.kind === "yes_no") {
    const labels = question.kind === "yes_no" ? ["Sì", "No"] : [...question.options];
    const tally = new Map<string, number>(labels.map((label) => [label, 0]));
    for (const { value } of given) {
      const picked = question.kind === "yes_no" ? [value === true ? "Sì" : "No"] : Array.isArray(value) ? value.map(String) : [String(value)];
      for (const option of picked) tally.set(option, (tally.get(option) ?? 0) + 1);
    }
    const counts = [...tally.entries()].map(([option, count]) => ({ option, count, percent: answered ? Math.round((count / answered) * 100) : 0 }));
    return { kind: "choice", answered, counts };
  }

  if (question.kind === "number" || question.kind === "rating") {
    const numbers = given.map((entry) => Number(entry.value)).filter((n) => Number.isFinite(n));
    const average = numbers.length ? round1(numbers.reduce((sum, n) => sum + n, 0) / numbers.length) : 0;
    const summary: QuestionSummary = {
      kind: "number", answered: numbers.length, average,
      min: numbers.length ? Math.min(...numbers) : 0, max: numbers.length ? Math.max(...numbers) : 0,
    };
    if (question.kind === "rating") {
      summary.counts = [5, 4, 3, 2, 1].map((star) => {
        const count = numbers.filter((n) => n === star).length;
        return { option: `${star}`, count, percent: numbers.length ? Math.round((count / numbers.length) * 100) : 0 };
      });
    }
    return summary;
  }

  return {
    kind: "text", answered,
    entries: given
      .map(({ response, value }) => ({ name: response.respondent_name, text: formatAnswer(question, value), at: response.created_at }))
      .sort((a, b) => b.at.localeCompare(a.at)),
  };
}

/** Domande da mostrare nel riepilogo: quelle attive più le archiviate che hanno ancora risposte. */
export function questionsWithAnswers(questions: FormQuestion[], responses: FormResponse[]): FormQuestion[] {
  return questions.filter((question) => !question.archived_at || responses.some((response) => !isEmptyAnswer(response.answers?.[question.id])));
}

export function businessFormErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : "";
  const required = text.match(/BUSINESS_FORM_REQUIRED:(.*)$/m);
  if (required) return `Rispondi alla domanda obbligatoria: ${required[1].trim()}`;
  const known: Record<string, string> = {
    BUSINESS_FORM_FORBIDDEN: "Questo form è riservato ai Capi Area.",
    BUSINESS_FORM_NOT_FOUND: "Questo link non è valido o il form è stato eliminato.",
    BUSINESS_FORM_CLOSED: "Questo form è chiuso: non accetta più risposte.",
    BUSINESS_FORM_INVALID: "Una delle risposte non è valida. Controlla e riprova.",
    BUSINESS_FORM_TOO_LONG: "Una delle risposte è troppo lunga.",
    FORBIDDEN: "Non hai i permessi per questa operazione.",
    UNAUTHORIZED: "Accedi nuovamente.",
  };
  for (const [code, message] of Object.entries(known)) if (text.includes(code)) return message;
  return text || "Operazione non riuscita.";
}
