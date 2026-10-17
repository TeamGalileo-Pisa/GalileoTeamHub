export interface MeetingWindow { start_time: string; end_time: string }

export const SLOT_MINUTES = 30;

/** "09:30:00" → "09:30" */
export const hhmm = (value: string) => value.slice(0, 5);

const toMinutes = (value: string) => {
  const [h, m] = value.split(":");
  return Number(h) * 60 + Number(m);
};

export const fromMinutes = (total: number) =>
  `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;

/** Divide le fasce di disponibilità in slot da 30 minuti (orari di inizio, "HH:MM"), ordinati e senza duplicati. */
export function slotsFromWindows(windows: MeetingWindow[]): string[] {
  const starts = new Set<string>();
  for (const window of windows) {
    for (let t = toMinutes(window.start_time); t + SLOT_MINUTES <= toMinutes(window.end_time); t += SLOT_MINUTES) {
      starts.add(fromMinutes(t));
    }
  }
  return [...starts].sort();
}

/** Orari selezionabili per inizio/fine fascia: ogni 30 minuti, 00:00–23:30. */
export const TIME_OPTIONS: string[] = Array.from({ length: 48 }, (_, i) => fromMinutes(i * SLOT_MINUTES));

export const slotEnd = (start: string) => fromMinutes(toMinutes(start) + SLOT_MINUTES);

/** Raggruppa orari di inizio consecutivi in intervalli leggibili: ["09:00","09:30","10:30"] → ["09:00–10:00","10:30–11:00"]. */
export function describeSlotRanges(starts: string[]): string[] {
  const sorted = [...starts].sort();
  const ranges: string[] = [];
  let from: string | null = null;
  let prev: string | null = null;
  for (const start of sorted) {
    if (from && prev && toMinutes(start) === toMinutes(prev) + SLOT_MINUTES) {
      prev = start;
      continue;
    }
    if (from && prev) ranges.push(`${from}–${slotEnd(prev)}`);
    from = start;
    prev = start;
  }
  if (from && prev) ranges.push(`${from}–${slotEnd(prev)}`);
  return ranges;
}

export function meetingErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : "";
  const known: Record<string, string> = {
    meeting_room_availability_start_time_check: "Gli orari devono essere ogni 30 minuti (es. 09:00 o 09:30).",
    meeting_room_availability_end_time_check: "Gli orari devono essere ogni 30 minuti (es. 13:00 o 13:30).",
    MEETING_NOT_ALLOWED: "Non hai i permessi per prenotare le aule.",
    MEETING_NO_SLOTS: "Seleziona almeno uno slot.",
    MEETING_TITLE_REQUIRED: "Indica il motivo della riunione.",
    MEETING_ROOM_NOT_FOUND: "L'aula non è più disponibile.",
    MEETING_SLOT_INVALID: "Orario non valido: gli slot sono da 30 minuti.",
    MEETING_SLOT_IN_THE_PAST: "Non puoi prenotare uno slot già passato.",
    MEETING_SLOT_NOT_AVAILABLE: "Uno degli slot non è più disponibile.",
    MEETING_SLOT_TAKEN: "Uno degli slot è appena stato prenotato da qualcun altro. Aggiorna e riprova.",
    MEETING_AVAILABILITY_OVERLAP: "Questa fascia si sovrappone a una già inserita per la stessa aula.",
    MEETING_AVAILABILITY_HAS_BOOKINGS: "In questa fascia ci sono già slot prenotati: cancella prima le prenotazioni.",
  };
  for (const [code, message] of Object.entries(known)) if (text.includes(code)) return message;
  return text || "Operazione non riuscita.";
}
