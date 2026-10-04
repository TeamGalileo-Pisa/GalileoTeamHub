import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { membershipPdf } from "./membership-pdf";
describe("Membership PDF", () => {
  it("creates a printable A4 document with ordinary member data", async () => {
    const bytes = await membershipPdf({
      firstName: "Mario",
      lastName: "Esempio",
      studentNumber: "123456",
      degree: "Ingegneria Robotica",
      department: "Ingegneria",
      area: "Software",
      date: "03/10/2026",
    });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getWidth()).toBeCloseTo(595.28);
  });
  it("preserves the supplied single-page A4 layout for lengthy data outside WinAnsi", async () => {
    const bytes = await membershipPdf({
      firstName: "李",
      lastName: "Esempio",
      studentNumber: "123456",
      degree: "Corso molto lungo ".repeat(10),
      department: "Dipartimento ".repeat(13),
      area: "Software",
      date: "03/10/2026",
    });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getHeight()).toBeCloseTo(841.89);
  });
});

