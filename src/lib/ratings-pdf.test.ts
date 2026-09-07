import { describe, expect, it } from "vitest";
import type { CandidateRating } from "./hub-enhancements";
import { createRatingsPdf } from "./ratings-pdf";

const rows: CandidateRating[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    areaId: "00000000-0000-4000-8000-000000000002",
    areaName: "Logistica",
    firstName: "Mario",
    lastName: "Rossi",
    email: "mario@studenti.unipi.it",
    courseOfStudy: "Ingegneria Robotica e dell'Automazione",
    interviewDate: "2026-09-07",
    score: 27,
    comment: "Ottima motivazione e buona capacità di ragionamento durante il colloquio.",
    archivedAt: null,
    createdAt: "2026-09-07T10:00:00Z",
    updatedAt: "2026-09-07T10:00:00Z",
  },
];

describe("ratings PDF", () => {
  it("creates a valid per-area PDF containing ratings and comments", () => {
    const bytes = createRatingsPdf(
      "Logistica",
      rows,
      new Date("2026-09-07T12:00:00Z"),
    );
    const text = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");

    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("Votazioni - Area Logistica");
    expect(text).toContain("Mario Rossi");
    expect(text).toContain("Voto: 27/30");
    expect(text).toContain("Ottima motivazione");
    expect(text).toContain("/Type /Pages /Count 1");
    expect(text.endsWith("%%EOF\n")).toBe(true);
  });
});
