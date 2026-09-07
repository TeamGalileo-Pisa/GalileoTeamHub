import type { CandidateRating } from "./hub-enhancements";

type PdfLine = {
  text: string;
  bold?: boolean;
  size?: number;
  indent?: number;
  gapAfter?: number;
};

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const LEFT = 48;
const BODY_TOP = 710;
const BODY_BOTTOM = 68;

const cp1252: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

function winAnsiBytes(value: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0x3f;
    if (code <= 0xff) bytes.push(code);
    else bytes.push(cp1252[code] ?? 0x3f);
  }
  return Uint8Array.from(bytes);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function pdfLiteral(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ");
}

function wrapText(value: string, maxChars: number): string[] {
  const source = value.trim();
  if (!source) return ["—"];
  const lines: string[] = [];
  for (const paragraph of source.split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      if (!line) {
        line = word;
        continue;
      }
      if (`${line} ${word}`.length <= maxChars) {
        line += ` ${word}`;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function formatInterviewDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function printableDate(date: Date): string {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function safeFilename(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "area";
}

function buildBodyPages(rows: CandidateRating[]): PdfLine[][] {
  const pages: PdfLine[][] = [[]];
  let y = BODY_TOP;

  const newPage = () => {
    pages.push([]);
    y = BODY_TOP;
  };
  const addLine = (line: PdfLine) => {
    const size = line.size ?? 10;
    const height = Math.max(13, size + 3) + (line.gapAfter ?? 0);
    if (y - height < BODY_BOTTOM) newPage();
    pages[pages.length - 1].push(line);
    y -= height;
  };
  const addGap = (height: number) => {
    if (y - height < BODY_BOTTOM) newPage();
    y -= height;
  };

  if (!rows.length) {
    addLine({ text: "Nessuna valutazione presente per questa area.", size: 11 });
    return pages;
  }

  rows.forEach((row, index) => {
    if (y < BODY_BOTTOM + 115) newPage();
    addLine({
      text: `${index + 1}. ${row.firstName} ${row.lastName}`,
      bold: true,
      size: 12,
      gapAfter: 1,
    });
    addLine({ text: `Mail: ${row.email}`, size: 9.5 });
    for (const line of wrapText(`Corso di Studi: ${row.courseOfStudy}`, 84)) {
      addLine({ text: line, size: 9.5 });
    }
    addLine({
      text: `Colloquio: ${formatInterviewDate(row.interviewDate)}   Voto: ${row.score}/30   Stato: ${row.archivedAt ? "Archiviata" : "Attiva"}`,
      size: 9.5,
      gapAfter: 2,
    });
    addLine({ text: "Commento:", bold: true, size: 9.5 });
    for (const line of wrapText(row.comment || "—", 86)) {
      addLine({ text: line, size: 9.5, indent: 10 });
    }
    addGap(11);
  });

  return pages;
}

function textCommand(text: string, x: number, y: number, size: number, bold = false): string {
  return `BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${y} Td (${pdfLiteral(text)}) Tj ET\n`;
}

function renderPage(
  areaName: string,
  lines: PdfLine[],
  generatedAt: Date,
  pageNumber: number,
  pageCount: number,
): string {
  let output = "";
  output += "0.08 0.12 0.22 rg 0 782 595 60 re f\n";
  output += "1 1 1 rg\n";
  output += textCommand("TEAM GALILEO", LEFT, 816, 10, true);
  output += textCommand(`Votazioni - Area ${areaName}`, LEFT, 794, 18, true);
  output += "0.15 0.18 0.25 rg\n";
  output += textCommand(`Esportato il ${printableDate(generatedAt)} - ${lines.length ? "valutazioni e commenti" : "nessun dato"}`, LEFT, 755, 9);
  output += "0.75 0.78 0.83 RG 48 740 m 547 740 l S\n";

  let y = BODY_TOP;
  for (const line of lines) {
    const size = line.size ?? 10;
    output += "0.10 0.12 0.18 rg\n";
    output += textCommand(line.text, LEFT + (line.indent ?? 0), y, size, line.bold);
    y -= Math.max(13, size + 3) + (line.gapAfter ?? 0);
  }

  output += "0.45 0.48 0.55 rg\n";
  output += textCommand(`Team Galileo - Votazioni Area ${areaName}`, LEFT, 38, 8);
  output += textCommand(`Pagina ${pageNumber} di ${pageCount}`, PAGE_WIDTH - 110, 38, 8);
  return output;
}

export function createRatingsPdf(
  areaName: string,
  rows: CandidateRating[],
  generatedAt = new Date(),
): Uint8Array {
  const bodyPages = buildBodyPages(rows);
  const pageIds = bodyPages.map((_, index) => 5 + index * 2);
  const contentIds = bodyPages.map((_, index) => 6 + index * 2);
  const objectCount = 4 + bodyPages.length * 2;
  const objects = new Map<number, Uint8Array>();

  objects.set(1, winAnsiBytes("<< /Type /Catalog /Pages 2 0 R >>"));
  objects.set(
    2,
    winAnsiBytes(`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`),
  );
  objects.set(3, winAnsiBytes("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"));
  objects.set(4, winAnsiBytes("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"));

  bodyPages.forEach((lines, index) => {
    const pageId = pageIds[index];
    const contentId = contentIds[index];
    const content = winAnsiBytes(
      renderPage(areaName, lines, generatedAt, index + 1, bodyPages.length),
    );
    objects.set(
      pageId,
      winAnsiBytes(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`,
      ),
    );
    objects.set(
      contentId,
      concatBytes([
        winAnsiBytes(`<< /Length ${content.length} >>\nstream\n`),
        content,
        winAnsiBytes("endstream"),
      ]),
    );
  });

  const parts: Uint8Array[] = [winAnsiBytes("%PDF-1.4\n%âãÏÓ\n")];
  const offsets = new Array<number>(objectCount + 1).fill(0);
  let currentOffset = parts[0].length;

  for (let id = 1; id <= objectCount; id += 1) {
    const body = objects.get(id);
    if (!body) throw new Error(`PDF_OBJECT_MISSING_${id}`);
    offsets[id] = currentOffset;
    const prefix = winAnsiBytes(`${id} 0 obj\n`);
    const suffix = winAnsiBytes("\nendobj\n");
    parts.push(prefix, body, suffix);
    currentOffset += prefix.length + body.length + suffix.length;
  }

  const xrefOffset = currentOffset;
  let xref = `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= objectCount; id += 1) {
    xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  parts.push(winAnsiBytes(xref));
  return concatBytes(parts);
}

export function downloadRatingsPdf(areaName: string, rows: CandidateRating[]): void {
  const bytes = createRatingsPdf(areaName, rows);
  const blobBytes = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([blobBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
  link.href = url;
  link.download = `votazioni-${safeFilename(areaName)}-${today}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
