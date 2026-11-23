import { describe, expect, it } from "vitest";
import { cfuPdf, cfuPdfFileName } from "./cfu-pdf";
import type { CfuMember } from "./cfu";

const member: CfuMember = {
  id: "1", first_name: "Giulia", last_name: "D'Angelo È", student_number: "123456", degree: "Ing. Robotica", department: "DESTEC", professor_name: "Prof. Rossi", professor_email: "rossi@unipi.it",
  area_id: null, division: "Mobility Division", team_role: "Membro", period_from: "2025-10-01", period_to: "2026-09-30",
  description: "Ha progettato il sistema di sospensioni.\n".repeat(60),
  ratings: { competenza: "buono", autonomia: "buono", problem_solving: "buono", costanza: "buono", teamwork: "buono", comunicazione: "buono", sicurezza: "buono", documentazione: "buono", applicazione: "buono", coordinamento: "buono", innovazione: "buono", risorse: "buono", divulgazione: "buono", relazioni_esterne: "buono", feedback: "buono", correttezza: "buono" },
  evaluated_at: null,
};

describe("PDF scheda CFU", () => {
  it("genera un PDF valido anche con descrizione lunga e caratteri accentati", async () => {
    const bytes = await cfuPdf(member, { date: new Date("2026-11-23T12:00:00Z") });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(2000);
  });

  it("nome file senza accenti né spazi", () => {
    expect(cfuPdfFileName(member)).toBe("Scheda_CFU_D_Angelo_E_Giulia.pdf");
  });
});
