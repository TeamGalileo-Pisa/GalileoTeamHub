import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { cfuLogoAspect, cfuLogoBase64 } from "./cfu-logo.ts";
import { CFU_CRITERIA, CFU_LEVELS, cfuFinalGrade, cfuScore, cfuVerdict, type CfuMember } from "./cfu.ts";

const A4 = [595.28, 841.89] as const;
const LEFT = 70.9; // 2,5 cm
const RIGHT = A4[0] - 70.9;
const WIDTH = RIGHT - LEFT;
const TOP = A4[1] - 70.9;
const BOTTOM = 70.9;

const formatDate = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("it-IT") : "");

/** Scheda di valutazione CFU, stessa impaginazione del modulo LaTeX, con valutazione finale in trentesimi. */
export async function cfuPdf(member: CfuMember, options: { areaName?: string; date?: Date } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const black = rgb(0, 0, 0);

  const safe = (value: unknown) => Array.from(String(value ?? "").normalize("NFC")).map((c) => {
    try { regular.encodeText(c); return c; } catch { return "?"; }
  }).join("");

  let page: PDFPage = doc.addPage([...A4]);
  let y = TOP;

  const newPage = () => { page = doc.addPage([...A4]); y = TOP; };
  const ensure = (height: number) => { if (y - height < BOTTOM) newPage(); };
  const text = (value: string, x: number, baseline: number, size: number, font: PDFFont = regular) =>
    page.drawText(safe(value), { x, y: baseline, size, font, color: black });
  const widthOf = (value: string, size: number, font: PDFFont = regular) => font.widthOfTextAtSize(safe(value), size);
  const centered = (value: string, size: number, font: PDFFont = regular) => {
    text(value, (A4[0] - widthOf(value, size, font)) / 2, y, size, font);
  };
  const rule = (x1: number, x2: number, at: number, thickness = 0.6) =>
    page.drawLine({ start: { x: x1, y: at }, end: { x: x2, y: at }, thickness, color: black });
  const wrap = (value: string, size: number, font: PDFFont, maxWidth: number) => {
    const lines: string[] = [];
    for (const rawLine of String(value ?? "").split(/\r?\n/).map((part) => safe(part))) {
      let line = "";
      for (const word of rawLine.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) { lines.push(line); line = word; } else line = candidate;
      }
      lines.push(line);
    }
    return lines;
  };
  const paragraph = (value: string, size = 11, font: PDFFont = regular, after = 6, x = LEFT, maxWidth = WIDTH) => {
    const leading = size * 1.5;
    for (const line of wrap(value, size, font, maxWidth)) {
      ensure(leading);
      text(line, x, y, size, font);
      y -= leading;
    }
    y -= after;
  };
  /** Etichetta in grassetto seguita da un valore sopra una linea (come underline nel LaTeX). */
  const field = (label: string, value: string, x: number, lineWidth: number, size = 11): number => {
    text(label, x, y, size, bold);
    const start = x + widthOf(label, size, bold) + 4;
    const end = Math.min(start + lineWidth, RIGHT);
    rule(start, end, y - 2, 0.5);
    if (value) {
      let fontSize = size;
      while (fontSize > 6 && widthOf(value, fontSize) > end - start - 2) fontSize -= 0.5;
      text(value, start + 1, y, fontSize);
    }
    return end;
  };
  const checkbox = (x: number, baseline: number, checked: boolean, size = 9) => {
    page.drawRectangle({ x, y: baseline - 1.5, width: size, height: size, borderColor: black, borderWidth: 0.7 });
    if (checked) {
      page.drawLine({ start: { x: x + 1.5, y: baseline }, end: { x: x + size - 1.5, y: baseline + size - 3 }, thickness: 1.3, color: black });
      page.drawLine({ start: { x: x + 1.5, y: baseline + size - 3 }, end: { x: x + size - 1.5, y: baseline }, thickness: 1.3, color: black });
    }
  };
  const heading = (title: string) => { ensure(40); y -= 8; text(title, LEFT, y, 11, bold); y -= 16; };

  const ratings = member.ratings ?? {};
  const score = cfuScore(ratings);
  const verdict = cfuVerdict(score);

  // Intestazione con logo
  try {
    const logo = await doc.embedPng(cfuLogoBase64);
    const width = 85;
    const height = width * cfuLogoAspect;
    page.drawImage(logo, { x: (A4[0] - width) / 2, y: y - height + 8, width, height });
    y -= height + 8;
  } catch { /* il logo è facoltativo */ }
  centered("SCHEDA DI VALUTAZIONE", 14, bold); y -= 17;
  centered("Ai fini del Riconoscimento CFU — Attività all'interno del Team Galileo", 11, bold); y -= 15;
  centered("[1247I] — Laboratorio di Automazione e Robotica", 11, italic); y -= 22;

  paragraph(
    "Nota esplicativa: La presente scheda viene compilata dal Team Leader e trasmessa alla Commissione d'Esame prima della prova. Il giudizio espresso si riferisce esclusivamente all'attività, all'impegno e alle competenze dimostrate dal candidato nello svolgimento dei compiti assegnati all'interno del Team Galileo durante l'Anno Accademico, restando esclusa la valutazione dell'elaborato di progetto specifico di competenza del CdL.",
    8.5, italic, 10,
  );

  // 1. Dati anagrafici
  heading("1. DATI ANAGRAFICI E INQUADRAMENTO NEL TEAM");
  const row = (build: () => void) => { ensure(20); build(); y -= 20; };
  row(() => field("Cognome e Nome:", `${member.last_name} ${member.first_name}`.trim(), LEFT, 230));
  row(() => { const end = field("Matricola:", member.student_number, LEFT, 100); field("Corso di Studi:", member.degree, end + 12, RIGHT - end - 12 - 85); });
  row(() => field("Dipartimento / Area:", member.department || options.areaName || "", LEFT, 200));
  row(() => field("Divisione / Settore di appartenenza:", member.division || options.areaName || "", LEFT, 150));
  row(() => field("Ruolo ricoperto nel Team:", member.team_role, LEFT, 200));
  row(() => {
    text("Periodo di attività valutato:", LEFT, y, 11, bold);
    let x = LEFT + widthOf("Periodo di attività valutato:", 11, bold) + 6;
    text("Da", x, y, 11); x += widthOf("Da", 11) + 4;
    rule(x, x + 70, y - 2, 0.5); text(formatDate(member.period_from), x + 1, y, 11); x += 78;
    text("a", x, y, 11); x += widthOf("a", 11) + 4;
    rule(x, x + 70, y - 2, 0.5); text(formatDate(member.period_to), x + 1, y, 11);
  });

  // 2. Parere dei responsabili
  heading("2. PARERE VINCOLANTE DEI RESPONSABILI");
  paragraph("Il presente modulo viene compilato d'intesa con il Direttore Tecnico e Responsabile d'Area di riferimento.", 11, regular, 4);
  ensure(20);
  text("Parere del Responsabile di Divisione:", LEFT, y, 11, bold);
  let x = LEFT + widthOf("Parere del Responsabile di Divisione:", 11, bold) + 10;
  checkbox(x, y, true); x += 14; text("Favorevole", x, y, 11); x += widthOf("Favorevole", 11) + 24;
  checkbox(x, y, false); x += 14; text("Contrario", x, y, 11);
  y -= 24;

  // 3. Descrizione
  heading("3. DESCRIZIONE DETTAGLIATA DEI COMPITI E DELLE ATTIVITÀ SVOLTE");
  paragraph("(Indicare le mansioni specifiche, i progetti seguiti e le responsabilità assunte dal membro all'interno della propria divisione durante l'anno)", 10, italic, 6);
  paragraph(member.description.trim() || " ", 11, regular, 12);

  // 4. Matrice (nuova pagina, come newpage nel LaTeX)
  newPage();
  heading("4. MATRICE DI VALUTAZIONE TRASVERSALE DELLE COMPETENZE NEL TEAM");
  paragraph("Indicare con una crocetta (×) il livello di giudizio assegnato per ciascun criterio:", 11, italic, 8);

  const labelWidth = 190;
  const colWidth = (WIDTH - labelWidth) / CFU_LEVELS.length;
  rule(LEFT, RIGHT, y + 12, 1.2);
  text("Criterio di Valutazione", LEFT, y, 9, bold);
  CFU_LEVELS.forEach((level, index) => {
    const cx = LEFT + labelWidth + colWidth * index + colWidth / 2;
    text(level.label, cx - widthOf(level.label, 8.5, bold) / 2, y, 8.5, bold);
  });
  y -= 16;
  rule(LEFT, RIGHT, y, 0.6);
  y -= 6;
  for (const criterion of CFU_CRITERIA) {
    const lines = wrap(criterion.label, 9.5, regular, labelWidth - 6);
    const rowHeight = Math.max(28, lines.length * 12 + 10);
    ensure(rowHeight);
    lines.forEach((line, index) => text(line, LEFT, y - 14 - index * 12 + (lines.length - 1) * 6, 9.5));
    CFU_LEVELS.forEach((level, index) => {
      const cx = LEFT + labelWidth + colWidth * index + colWidth / 2;
      checkbox(cx - 4.5, y - 14 + 0.5, ratings[criterion.id] === level.id);
    });
    y -= rowHeight;
  }
  rule(LEFT, RIGHT, y + 4, 1.2);
  y -= 24;

  // 5. Giudizio sintetico
  heading("5. GIUDIZIO SINTETICO E PROPOSTA AL CORSO DI LAUREA");
  paragraph("Il sottoscritto Team Leader, visti i risultati conseguiti nell'ambito delle attività associative, esprime parere:", 11, regular, 6);
  ensure(48);
  checkbox(LEFT, y, verdict === "favorevole");
  text("FAVOREVOLE", LEFT + 16, y, 11, bold);
  text("al riconoscimento dei CFU per l'attività svolta nel Team.", LEFT + 16 + widthOf("FAVOREVOLE", 11, bold) + 7, y, 11);
  y -= 20;
  checkbox(LEFT, y, verdict === "contrario");
  text("CONTRARIO", LEFT + 16, y, 11, bold);
  text("al riconoscimento dei CFU.", LEFT + 16 + widthOf("CONTRARIO", 11, bold) + 7, y, 11);
  y -= 24;
  ensure(24);
  text("Valutazione finale di", LEFT, y, 11, bold);
  text(cfuFinalGrade(score), LEFT + widthOf("Valutazione finale di", 11, bold) + 6, y, 12, bold);
  y -= 26;

  ensure(60);
  text("Eventuali note o commenti descrittivi sull'operato:", LEFT, y, 11, bold); y -= 20;
  rule(LEFT, RIGHT, y, 0.5); y -= 20;
  rule(LEFT, RIGHT, y, 0.5); y -= 30;

  ensure(100);
  const date = (options.date ?? new Date()).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Rome" });
  text(`Pisa, li ${date}`, LEFT, y, 11);
  y -= 50;
  const sigWidth = 156;
  const sigX = RIGHT - 0.225 * WIDTH - sigWidth / 2;
  rule(sigX, sigX + sigWidth, y, 0.5);
  text("Team Leader", sigX + (sigWidth - widthOf("Team Leader", 10)) / 2, y - 13, 10);

  return doc.save();
}

export function cfuPdfFileName(member: Pick<CfuMember, "first_name" | "last_name">): string {
  const slug = `${member.last_name}_${member.first_name}`.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `Scheda_CFU_${slug || "membro"}.pdf`;
}
