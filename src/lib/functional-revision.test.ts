import { describe, expect, it } from "vitest";
import { bookingSchema } from "./booking-validation";
import {
  appointmentsOnDay,
  dailyDates,
  positionAppointments,
  romeInputToIso,
  toRomeInput,
  weekStart,
} from "./scheduling";
import {
  normalizeBookingFields,
  validateBookingFields,
} from "../../supabase/functions/_shared/booking-validation";
import {
  emailCopy,
  OFFICIAL_EMAIL_FROM,
  type DeliveryPayload,
} from "../../supabase/functions/_shared/email-copy";
import { toItalianErrorMessage } from "./errors";
const valid = {
  slotId: "a1000000-0000-4000-8000-000000000001",
  firstName: "Mario",
  lastName: "Rossi",
  email: "mario@studenti.unipi.it",
};
describe("candidate validation across frontend and Edge", () => {
  it.each(["firstName", "lastName", "email", "slotId"])(
    "rejects missing %s",
    (key) => {
      const data = { ...valid, [key]: "   " };
      expect(bookingSchema.safeParse(data).success).toBe(false);
      expect(validateBookingFields(data)).not.toBeNull();
    },
  );
  it.each([
    "a@gmail.com",
    "a@unipi.it",
    "a@studenti.unipi.com",
    "a@@studenti.unipi.it",
    "a b@studenti.unipi.it",
    "a@studenti.unipi.it.evil",
  ])("rejects %s", (email) => {
    expect(bookingSchema.safeParse({ ...valid, email }).success).toBe(false);
    expect(validateBookingFields({ ...valid, email })).toBe(
      "INVALID_STUDENT_EMAIL",
    );
  });
  it("normalizes whitespace and case", () => {
    const data = {
      ...valid,
      email: " MARIO@STUDENTI.UNIPI.IT ",
      firstName: " Mario ",
      lastName: " Rossi ",
    };
    expect(bookingSchema.parse(data)).toEqual(valid);
    expect(normalizeBookingFields(data)).toEqual(valid);
    expect(validateBookingFields(data)).toBeNull();
  });
  it("handles non-string malicious fields", () => {
    expect(validateBookingFields({ ...valid, email: { trim: "bad" } })).toBe(
      "INVALID_STUDENT_EMAIL",
    );
  });
  it("maps Edge error envelopes", () =>
    expect(toItalianErrorMessage({ error: "INVALID_STUDENT_EMAIL" })).toContain(
      "@studenti.unipi.it",
    ));
});
describe("daily availability and calendar", () => {
  it("shows legacy midnight-crossing appointments on both days without changing them", () => {
    const appointment = {
      startsAt: "2026-09-21T21:30:00Z",
      endsAt: "2026-09-21T22:30:00Z",
    };
    const first = appointmentsOnDay([appointment], "2026-09-21")[0];
    const next = appointmentsOnDay([appointment], "2026-09-22")[0];
    expect([first.startMinute, first.endMinute]).toEqual([1410, 1440]);
    expect([next.startMinute, next.endMinute]).toEqual([0, 30]);
    expect(next.original).toBe(appointment);
    expect(appointmentsOnDay([appointment], "2026-09-23")).toEqual([]);
  });
  it("creates five daily windows, not one continuous interval", () =>
    expect(dailyDates("2026-09-21", "2026-09-25", [1, 2, 3, 4, 5])).toEqual([
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
    ]));
  it("filters weekends and invalid spans", () => {
    expect(dailyDates("2026-09-21", "2026-09-27", [6, 7])).toHaveLength(2);
    expect(dailyDates("2026-09-25", "2026-09-21", [1])).toEqual([]);
  });
  it("uses Rome independently of the browser timezone", () => {
    expect(romeInputToIso("2026-09-21T08:30")).toBe("2026-09-21T06:30:00.000Z");
    expect(romeInputToIso("2026-12-21T08:30")).toBe("2026-12-21T07:30:00.000Z");
    expect(toRomeInput("2026-09-21T06:30:00Z")).toBe("2026-09-21T08:30");
  });
  it("rejects nonexistent DST times", () =>
    expect(() => romeInputToIso("2026-03-29T02:30")).toThrow());
  it("starts weeks on Monday", () =>
    expect(weekStart("2026-09-27")).toBe("2026-09-21"));
  it("positions variable duration overlapping appointments in separate lanes", () => {
    const p = positionAppointments([
      { startsAt: "2026-09-21T07:00Z", endsAt: "2026-09-21T07:20Z" },
      { startsAt: "2026-09-21T07:10Z", endsAt: "2026-09-21T08:00Z" },
      { startsAt: "2026-09-21T08:00Z", endsAt: "2026-09-21T08:30Z" },
    ]);
    expect(p.map((v) => v.lanes)).toEqual([2, 2, 1]);
    expect(p.map((v) => (v.end - v.start) / 60000)).toEqual([20, 50, 30]);
  });
});
describe("email copy", () => {
  const payload: DeliveryPayload = {
    delivery_id: "internal-id",
    attempt_count: 1,
    kind: "booking_confirmation",
    to_email: valid.email,
    candidate_name: "Mario Rossi",
    area_name: "Software",
    room_name: "A27",
    starts_at: "2026-09-21T06:30Z",
    ends_at: "2026-09-21T06:50Z",
  };
  it("uses the exact subject and official sender", () => {
    expect(emailCopy(payload).subject).toBe("Colloqui Team Galileo");
    expect(OFFICIAL_EMAIL_FROM).toBe(
      "Team Galileo Pisa <info.teamgalileo@gmail.com>",
    );
  });
  it("includes Italian date, real end time and required plain text", () => {
    const { text } = emailCopy(payload);
    expect(text).toContain("Grazie per aver selezionato il tuo slot orario.");
    expect(text).toContain("lunedì 21 settembre 2026");
    expect(text).toContain("Orario: 08:30 - 08:50");
    expect(text).toContain("Aula: A27");
    expect(text).toContain("Area: Software");
    expect(text).toContain("quindi non mancare.");
    expect(text).not.toContain(payload.delivery_id);
  });
  it.each([
    "booking_changed",
    "booking_cancelled",
    "booking_reminder",
  ] as const)("preserves %s notifications", (kind) => {
    const message = emailCopy({ ...payload, kind });
    expect(message.text).toContain("A27");
    expect(message.text).toContain(
      kind === "booking_cancelled"
        ? "annullato"
        : kind === "booking_changed"
          ? "nuovi dettagli"
          : "ricordiamo",
    );
  });
});
