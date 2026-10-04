import { PDFDocument, rgb, StandardFonts, type PDFFont } from "npm:pdf-lib@1.17.1";
import { membershipTerms } from "./membership-terms.ts";
import { membershipLogoBytes } from "./membership-logo.ts";

// Layout follows the supplied A4 HTML template: centered identity block, one
// framed personal-data area, section rules, a two-column signature row, and
// the two approval boxes anchored to the bottom margin.
export async function membershipPdf(data: Record<string, string>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const regular = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const black = rgb(0, 0, 0);
  const left = 28.35;
  const right = 566.93;
  const width = right - left;
  let y = 821.5;
  const safe = (s: unknown) => Array.from(String(s ?? "").normalize("NFC")).map((c) => {
    try { regular.encodeText(c); return c; } catch { return "?"; }
  }).join("");
  const drawText = (value: string, x: number, baseline: number, size: number, font = regular) =>
    page.drawText(safe(value), { x, y: baseline, size, font, color: black });
  const drawFitText = (value: string, x: number, baseline: number, maxWidth: number, initialSize = 8.1) => {
    const v = safe(value);
    let size = initialSize;
    while (size > 5.4 && regular.widthOfTextAtSize(v, size) > maxWidth) size -= 0.2;
    page.drawText(v, { x, y: baseline, size: Math.max(5.4, size), font: regular, color: black });
  };
  const centered = (value: string, baseline: number, size: number, font = regular) => {
    const v = safe(value);
    drawText(v, (595.28 - font.widthOfTextAtSize(v, size)) / 2, baseline, size, font);
  };
  const rule = (x1: number, x2: number, at: number, thickness = 0.65) =>
    page.drawLine({ start: { x: x1, y: at }, end: { x: x2, y: at }, thickness, color: black });
  const wrap = (value: string, font: PDFFont, size: number, maxWidth: number) => {
    const words = safe(value).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) { lines.push(line); line = word; }
      else line = candidate;
    }
    if (line) lines.push(line);
    return lines;
  };
  const paragraph = (value: string, x = left, size = 7.9, font = regular, maxWidth = width, leading = size * 1.22, after = 2, hanging = 0) => {
    wrap(value, font, size, maxWidth).forEach((line, index) => {
      drawText(line, x + (index ? hanging : 0), y, size, font);
      y -= leading;
    });
    y -= after;
  };
  const section = (title: string) => {
    drawText(title, left, y, 8.3, bold);
    y -= 3;
    rule(left, right, y);
    y -= 10;
  };
  const drawBox = (top: number, height: number) => page.drawRectangle({ x: left, y: top - height, width, height, borderColor: black, borderWidth: 0.8 });

  const logo = await doc.embedPng(membershipLogoBytes());
  const logoSize = 40;
  page.drawImage(logo, {
    x: (595.28 - logoSize) / 2,
    y: 798,
    width: logoSize,
    height: logoSize,
  });
  y -= 44;
  centered("MODULO DI INGRESSO NEL TEAM", y, 12, bold); y -= 14;
  centered("Anno Accademico 2026/2027", y, 9, italic); y -= 11;
  centered("teamleader.teamgalileo@gmail.com", y, 7.8, bold); y -= 6;
  rule(left, right, y, 1.1); y -= 9;

  const personalRows = [
    ["Il/La sottoscritto/a:", `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim()],
    ["Matricola:", data.studentNumber ?? ""],
    ["Corso di Laurea:", data.degree ?? ""],
    ["Dipartimento:", data.department ?? ""],
    ["Data decorrenza ingresso:", data.date ?? ""],
  ];
  const personalTop = y;
  const personalHeight = 137;
  drawBox(personalTop, personalHeight);
  let rowY = personalTop - 12;
  for (const [label, value] of personalRows) {
    drawText(label, left + 9, rowY, 8.1, bold); rowY -= 9;
    rule(left + 9, right - 9, rowY, 0.55);
    if (value) drawFitText(value, left + 9, rowY + 2, width - 18);
    rowY -= 16;
  }
  y = personalTop - personalHeight - 14;

  section("In tale sede si impegna a:");
  for (let index = 1; index <= 6; index++) paragraph(`${index}. ${membershipTerms[index]}`, left + 12, 7.9, regular, width - 12, 9.6, 2, 8);

  section("1. Accettazione del Regolamento Interno");
  paragraph(membershipTerms[8], left, 7.9, regular, width, 9.65, 2);
  section("2. Proprietà Intellettuale e responsabilità");
  paragraph(membershipTerms[10], left, 7.9, regular, width, 9.65, 2);
  section("3. Autocertificazione Requisiti");
  paragraph(membershipTerms[12], left, 7.9, regular, width, 9.65, 1);
  for (let index = 13; index <= 16; index++) paragraph(`${index - 12}. ${membershipTerms[index]}`, left + 12, 7.9, regular, width - 12, 9.5, 1, 8);
  section("4. Trattamento Dati Personali e Diritto all'Immagine (GDPR)");
  paragraph(membershipTerms[18], left, 7.9, regular, width, 9.65, 2);

  const footerBottom = 20;
  const facultyHeight = 37;
  const reservedHeight = 116;
  const footerTop = footerBottom + facultyHeight + 4 + reservedHeight;
  // Match the original 48% / 4% / 48% signature table above the footer boxes.
  const signatureRowTop = Math.max(y - 4, footerTop + 66);
  drawText("Luogo e Data:", left, signatureRowTop, 7.9, bold);
  rule(left, left + width * 0.48, signatureRowTop - 27, 0.55);
  drawText(`Pisa, ${safe(data.date ?? "")}`, left + 2, signatureRowTop - 23, 7.9);
  const sigX = left + width * 0.52;
  drawText("Firma del membro", sigX, signatureRowTop, 7.8, bold);
  rule(sigX, right, signatureRowTop - 27, 0.55);

  let top = footerTop;
  drawBox(top, reservedHeight);
  drawText("SPAZIO RISERVATO ALLA DIREZIONE", left + 9, top - 13, 7.5, bold);
  drawText("Assegnazione Ufficiale Area / Divisione / Ruolo di Coordinamento:", left + 9, top - 28, 7.6, bold);
  rule(left + 9, right - 9, top - 43, 0.55);
  if (data.area) drawText(data.area, left + 9, top - 40, 7.6);
  drawText("Note:", left + 9, top - 58, 7.6, bold);
  rule(left + 9, right - 9, top - 73, 0.55);
  drawText("Data di ricezione:", left + 9, top - 91, 7.6, bold);
  drawText("_____ / _____ / _________", left + 80, top - 91, 7.6);
  drawText("FIRMA DEL TEAM LEADER:", left + width * 0.55, top - 91, 7.5, bold);
  rule(left + width * 0.55, right - 9, top - 108, 0.55);
  top -= reservedHeight + 4;
  drawBox(top, facultyHeight);
  drawText("Visto e approvato dal Faculty Advisor", left + 9, top - 13, 7.8, bold);
  rule(left + 9, right - 9, top - 29, 0.55);
  return doc.save();
}
