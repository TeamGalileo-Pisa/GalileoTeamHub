import { format, isSameDay, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import { appConfig } from "./config";

const dateTimeFormatter = new Intl.DateTimeFormat("it-IT", {
  timeZone: appConfig.timezone,
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat("it-IT", {
  timeZone: appConfig.timezone,
  hour: "2-digit",
  minute: "2-digit",
});

const dayFormatter = new Intl.DateTimeFormat("it-IT", {
  timeZone: appConfig.timezone,
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
});

export function formatDateTime(value: string): string {
  return dateTimeFormatter.format(new Date(value));
}

export function formatTimeRange(startsAt: string, endsAt: string): string {
  return `${timeFormatter.format(new Date(startsAt))} – ${timeFormatter.format(new Date(endsAt))}`;
}

export function formatBookingDay(value: string): string {
  return dayFormatter.format(new Date(value));
}

export function formatDateOnly(value: string | null): string {
  if (!value) return "—";
  return format(parseISO(value), "d MMMM yyyy", { locale: it });
}

export function groupByDay<T extends { startsAt: string }>(items: T[]) {
  return items.reduce<Array<{ date: Date; items: T[] }>>((groups, item) => {
    const date = new Date(item.startsAt);
    const existing = groups.find((group) => isSameDay(group.date, date));

    if (existing) {
      existing.items.push(item);
    } else {
      groups.push({ date, items: [item] });
    }

    return groups;
  }, []);
}

