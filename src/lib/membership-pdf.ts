import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { membershipTerms } from "./membership-terms.ts";
export async function membershipPdf(
  data: Record<string, string>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  let page = doc.addPage([595.28, 841.89]);
  let y = 800;
  const clean = (s: string) =>
    Array.from(s.normalize("NFC")).map((c) => {
      try {
        regular.encodeText(c);
        return c;
      } catch {
        return "?";
      }
    }).join("");
  const line = (text: string, size = 10, strong = false) => {
    const font = strong ? bold : regular;
    const words = clean(text).split(/\s+/);
    let value = "";
    const draw = () => {
      if (y < 48) {
        page = doc.addPage([595.28, 841.89]);
        y = 800;
      }
      page.drawText(value, { x: 42, y, size, font, color: rgb(0, 0, 0) });
      y -= size + 2;
    };
    for (const word of words) {
      if (font.widthOfTextAtSize(value + " " + word, size) > 510 && value) {
        draw();
        value = word;
      } else value += (value ? " " : "") + word;
    }
    if (value) draw();
  };
  line("MODULO DI INGRESSO NEL TEAM GALILEO", 15, true);
  line("Anno Accademico 2026/2027", 11);
  line("teamleader.teamgalileo@gmail.com", 10);
  y -= 10;
  for (
    const [label, value] of [
      ["Il/La sottoscritto/a", `${data.firstName} ${data.lastName}`],
      ["Matricola", data.studentNumber],
      ["Corso di Laurea", data.degree],
      ["Dipartimento", data.department],
      ["Data decorrenza ingresso", data.date],
    ]
  ) {
    line(label + ": " + (value ?? ""), 10);
    y -= 5;
  }
  y -= 5;
  for (const paragraph of membershipTerms) {
    line(paragraph, 8.3, /^\d\.|In tale sede/.test(paragraph));
    y -= 2;
  }
  if (y < 190) {
    page = doc.addPage([595.28, 841.89]);
    y = 800;
  }
  y -= 12;
  line("Luogo e data: Pisa, " + data.date);
  y -= 12;
  line("Firma del membro: __________________________________________________");
  y -= 18;
  line("SPAZIO RISERVATO ALLA DIREZIONE", 10, true);
  line("Assegnazione ufficiale Area / Divisione / Ruolo: " + data.area);
  line("Note: ______________________________________________________________");
  y -= 6;
  line("Data di ricezione: ____ / ____ / ________");
  y -= 12;
  line("Firma del Team Leader: ______________________________________________");
  y -= 18;
  line("Visto e approvato dal Faculty Advisor", 10, true);
  y -= 12;
  line("____________________________________________________________________");
  return doc.save();
}
