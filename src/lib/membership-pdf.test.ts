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
  it("paginates long data without crashing on names outside WinAnsi", async () => {
    const bytes = await membershipPdf({
      firstName: "李",
      lastName: "Esempio",
      studentNumber: "123456",
      degree: "Corso molto lungo ".repeat(40),
      department: "Dipartimento ".repeat(30),
      area: "Software",
      date: "03/10/2026",
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });
});
