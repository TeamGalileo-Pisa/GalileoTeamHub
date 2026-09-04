import { z } from "zod";

export const dailyAvailabilitySchema = z
  .object({
    roomId: z.string().uuid("Seleziona un’aula."),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Inserisci la data iniziale."),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Inserisci la data finale."),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, "Inserisci l’ora iniziale."),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, "Inserisci l’ora finale."),
    weekdays: z
      .array(z.number().int().min(1).max(7))
      .min(1, "Seleziona almeno un giorno della settimana."),
    capacity: z.number().int().min(1, "La capacità minima è 1.").max(100),
    note: z.string().trim().max(2000),
  })
  .refine(
    (v) =>
      v.endDate >= v.startDate &&
      (Date.parse(v.endDate) - Date.parse(v.startDate)) / 86400000 <= 366,
    {
      path: ["endDate"],
      message: "Scegli un periodo valido di massimo un anno.",
    },
  )
  .refine((v) => v.endTime > v.startTime, {
    path: ["endTime"],
    message: "La fine deve essere successiva all’inizio nello stesso giorno.",
  })
  .refine((v) => dailyDates(v.startDate, v.endDate, v.weekdays).length > 0, {
    path: ["weekdays"],
    message: "Nessuna giornata corrisponde alla selezione.",
  });

export type DailyAvailabilityInput = z.infer<typeof dailyAvailabilitySchema>;

export function dailyDates(
  start: string,
  end: string,
  weekdays: number[],
): string[] {
  const first = Date.parse(start),
    last = Date.parse(end);
  if (
    !Number.isFinite(first) ||
    !Number.isFinite(last) ||
    last < first ||
    last - first > 366 * 86400000
  )
    return [];
  const days: string[] = [];
  for (let t = first; t <= last; t += 86400000) {
    const date = new Date(t);
    if (weekdays.includes(date.getUTCDay() || 7))
      days.push(date.toISOString().slice(0, 10));
  }
  return days;
}

const romeParts = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Rome",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export function toRomeInput(value: string): string {
  return romeParts.format(new Date(value)).replace(" ", "T");
}
export function romeInputToIso(value: string): string {
  const target = Date.parse(`${value}:00Z`);
  let instant = target;
  for (let i = 0; i < 3; i++)
    instant +=
      target -
      Date.parse(`${toRomeInput(new Date(instant).toISOString())}:00Z`);
  const result = new Date(instant).toISOString();
  if (toRomeInput(result) !== value)
    throw new Error(
      "L’orario non esiste nel fuso Europe/Rome. Scegli un altro orario.",
    );
  return result;
}
export function dateShift(date: string, days: number): string {
  return new Date(Date.parse(date) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function weekStart(date: string): string {
  return dateShift(date, -((new Date(date).getUTCDay() + 6) % 7));
}

/** Clip legacy appointments to each visible Rome day without changing their data. */
export function appointmentsOnDay<
  T extends { startsAt: string; endsAt: string },
>(items: T[], day: string) {
  const dayStart = Date.parse(romeInputToIso(day + "T00:00"));
  const dayEnd = Date.parse(romeInputToIso(dateShift(day, 1) + "T00:00"));
  const wallMinutes = (instant: number) => {
    const local = toRomeInput(new Date(instant).toISOString());
    return Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16));
  };
  return items.flatMap((original) => {
    const start = Math.max(dayStart, Date.parse(original.startsAt));
    const end = Math.min(dayEnd, Date.parse(original.endsAt));
    return end > start
      ? [
          {
            original,
            startsAt: new Date(start).toISOString(),
            endsAt: new Date(end).toISOString(),
            startMinute: start === dayStart ? 0 : wallMinutes(start),
            endMinute: end === dayEnd ? 1440 : wallMinutes(end),
          },
        ]
      : [];
  });
}

export function positionAppointments<
  T extends { startsAt: string; endsAt: string },
>(items: T[]) {
  const sorted = [...items].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  );
  const placed: Array<{
    item: T;
    lane: number;
    lanes: number;
    start: number;
    end: number;
  }> = [];
  let group: typeof placed = [],
    ends: number[] = [],
    groupEnd = 0;
  const finish = () => {
    group.forEach((p) => (p.lanes = ends.length));
    group = [];
    ends = [];
  };
  for (const item of sorted) {
    const start = Date.parse(item.startsAt),
      end = Date.parse(item.endsAt);
    if (start >= groupEnd) finish();
    let lane = ends.findIndex((t) => t <= start);
    if (lane < 0) lane = ends.length;
    ends[lane] = end;
    groupEnd = Math.max(groupEnd, end);
    const p = { item, lane, lanes: 1, start, end };
    placed.push(p);
    group.push(p);
  }
  finish();
  return placed;
}
