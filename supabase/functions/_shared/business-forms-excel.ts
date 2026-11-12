import { strToU8, zipSync } from "npm:fflate@0.8.2";

// Stesso formato dell'Excel delle candidature: una riga per compilazione, una colonna per domanda.
// Foglio 2 "Riepilogo": per ogni domanda la distribuzione delle risposte.
export type BusinessFormQuestion = {
  id: string;
  label: string;
  kind: string;
  options: string[];
  archived_at: string | null;
};

export type SnapshotQuestion = { id: string; label: string; kind: string; options?: string[] };

export type BusinessFormResponseRow = {
  respondentName: string;
  respondentUsername: string;
  areaNames: string;
  createdAt: string;
  answers: Record<string, unknown>;
  // Domande così come erano al momento della compilazione (il form può cambiare nel tempo).
  questions: SnapshotQuestion[];
};

type Column = { key: string; id: string; label: string; kind: string; options: string[]; current: boolean };
const columnKey = (q: SnapshotQuestion) => `${q.id}|${q.kind}|${q.label}`;

const rome = new Intl.DateTimeFormat("it-IT", {
  timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});

const cleanXml = (value: unknown) => String(value ?? "")
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&apos;");

function columnName(index: number) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function cell(reference: string, value: unknown, header = false) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${reference}"${header ? ' s="1"' : ""}><v>${value}</v></c>`;
  }
  return `<c r="${reference}" t="inlineStr"${header ? ' s="1"' : ""}><is><t xml:space="preserve">${cleanXml(value)}</t></is></c>`;
}

export function displayAnswer(kind: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "Sì" : "No";
  if (Array.isArray(value)) return value.map(String).join("; ");
  if (kind === "rating") return `${value} / 5`;
  if (kind === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d}/${m}/${y}`;
  }
  return String(value);
}

const isEmpty = (value: unknown) =>
  value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);

function sheetXml(records: unknown[][], widths: number[], freezeColumns = 0) {
  const lastColumn = columnName(Math.max(records[0]?.length ?? 1, 1) - 1);
  const rows = records.map((record, rowIndex) =>
    `<row r="${rowIndex + 1}">${record.map((value, colIndex) => cell(`${columnName(colIndex)}${rowIndex + 1}`, value, rowIndex === 0)).join("")}</row>`
  ).join("");
  const cols = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  const pane = freezeColumns
    ? `<pane xSplit="${freezeColumns}" ySplit="1" topLeftCell="${columnName(freezeColumns)}2" activePane="bottomRight" state="frozen"/>`
    : `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${cols}</cols><sheetData>${rows}</sheetData><autoFilter ref="A1:${lastColumn}${records.length}"/></worksheet>`;
}

export function businessFormExcel(
  formTitle: string,
  questions: BusinessFormQuestion[],
  responses: BusinessFormResponseRow[],
) {
  // Una colonna per ogni domanda "come è stata posta": id + testo. Se il testo cambia nel tempo nasce
  // una nuova colonna, così le vecchie risposte restano associate alla domanda originale.
  const active = questions.filter((q) => !q.archived_at);
  const order = new Map(active.map((q, index) => [q.id, index]));
  const byKey = new Map<string, Column>();
  const oldestFirst = [...responses].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const response of oldestFirst) {
    for (const q of response.questions ?? []) {
      const key = columnKey(q);
      const existing = byKey.get(key);
      if (existing) existing.options = [...new Set([...existing.options, ...(q.options ?? [])])];
      else byKey.set(key, { key, id: q.id, label: q.label, kind: q.kind, options: [...(q.options ?? [])], current: active.some((c) => c.id === q.id && c.label === q.label) });
    }
  }
  const columns = [...byKey.values()]
    .map((column, index) => ({ column, index }))
    .sort((a, b) => (order.get(a.column.id) ?? Infinity) - (order.get(b.column.id) ?? Infinity) || a.index - b.index)
    .map((entry) => entry.column);
  const label = (c: Column) => c.current ? c.label : `${c.label} (domanda cambiata o eliminata)`;
  const asked = (r: BusinessFormResponseRow, c: Column) => (r.questions ?? []).some((q) => columnKey(q) === c.key);

  const answers: unknown[][] = [
    ["Data e ora", "Account", "Username", "Area (Capo di)", ...columns.map(label)],
    ...responses.map((r) => [
      rome.format(new Date(r.createdAt)),
      r.respondentName,
      r.respondentUsername,
      r.areaNames,
      ...columns.map((c) => {
        if (!asked(r, c)) return "";
        const value = r.answers?.[c.id];
        return c.kind === "number" && typeof value === "number" ? value : displayAnswer(c.kind, value);
      }),
    ]),
  ];

  const summary: unknown[][] = [["Domanda", "Risposta", "Numero risposte", "Percentuale (%)"]];
  for (const c of columns) {
    const given = responses.filter((r) => asked(r, c)).map((r) => r.answers?.[c.id]).filter((v) => !isEmpty(v));
    if (["single_choice", "multiple_choice", "yes_no", "rating"].includes(c.kind)) {
      const labels = c.kind === "yes_no" ? ["Sì", "No"] : c.kind === "rating" ? ["5", "4", "3", "2", "1"] : c.options;
      const tally = new Map<string, number>(labels.map((l) => [l, 0]));
      for (const value of given) {
        const picked = c.kind === "yes_no"
          ? [value === true ? "Sì" : "No"]
          : Array.isArray(value) ? value.map(String) : [String(value)];
        for (const option of picked) tally.set(option, (tally.get(option) ?? 0) + 1);
      }
      for (const [option, count] of tally) {
        summary.push([label(c), option, count, given.length ? Math.round((count / given.length) * 100) : 0]);
      }
      if (c.kind === "rating") {
        const numbers = given.map(Number).filter(Number.isFinite);
        if (numbers.length) summary.push([label(c), "Media", Math.round((numbers.reduce((a, b) => a + b, 0) / numbers.length) * 10) / 10, ""]);
      }
    } else if (c.kind === "number") {
      const numbers = given.map(Number).filter(Number.isFinite);
      if (numbers.length) {
        summary.push([label(c), "Media", Math.round((numbers.reduce((a, b) => a + b, 0) / numbers.length) * 100) / 100, ""]);
        summary.push([label(c), "Minimo", Math.min(...numbers), ""]);
        summary.push([label(c), "Massimo", Math.max(...numbers), ""]);
      }
    } else {
      summary.push([label(c), "Risposte testuali", given.length, ""]);
    }
  }

  const sheet1 = sheetXml(answers, [18, 24, 20, 24, ...columns.map((c) => Math.min(48, Math.max(20, Math.ceil(label(c).length * 0.9))))], 2);
  const sheet2 = sheetXml(summary, [48, 30, 18, 14]);
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews><sheets><sheet name="Risposte" sheetId="1" r:id="rId1"/><sheet name="Riepilogo" sheetId="2" r:id="rId2"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17365D"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
    "xl/worksheets/sheet1.xml": strToU8(sheet1),
    "xl/worksheets/sheet2.xml": strToU8(sheet2),
  };
  void formTitle;
  return zipSync(files, { level: 6 });
}
