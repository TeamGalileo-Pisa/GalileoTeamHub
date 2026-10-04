import { strToU8, zipSync } from "npm:fflate@0.8.2";

export type MembershipExportRow = {
  status: string;
  assignedArea: string;
  answers: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
};

const headers = [
  "Stato",
  "Area assegnata",
  "Nome",
  "Cognome",
  "Corso di Laurea",
  "Dipartimento di afferenza",
  "Matricola",
  "Divisione/Area di appartenenza",
  "Ruolo nella Direzione tecnica",
  "Impegni dichiarati",
  "Regolamento interno",
  "Proprietà intellettuale e responsabilità",
  "Autocertificazione requisiti",
  "Consenso dati personali e immagini",
  "Email istituzionale",
  "Numero di cellulare",
  "Profilo LinkedIn",
  "Consenso privacy amministrativa",
  "Creato il",
  "Ultimo salvataggio",
  "Inviato il",
];

const answerColumns = [
  "firstName", "lastName", "degree", "department", "studentNumber", "area",
  "leadershipRole", "commitmentsAccepted", "internalRegulationAccepted", "ipAccepted",
  "selfCertificationAccepted", "gdprAccepted", "institutionalEmail", "phone", "linkedin", "privacyAccepted",
] as const;

const xml = (value: unknown) => String(value ?? "")
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

function cell(reference: string, value: unknown, style = 0) {
  const text = xml(value);
  return `<c r="${reference}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${text}</t></is></c>`;
}

export function membershipExcel(rows: MembershipExportRow[]) {
  const records = [
    headers,
    ...rows.map((row) => {
      const a = row.answers ?? {};
      return [
        row.status === "submitted" ? "Inviato" : "Bozza",
        row.assignedArea,
        ...answerColumns.map((key) => a[key] ?? ""),
        row.createdAt,
        row.updatedAt,
        row.submittedAt ?? "",
      ];
    }),
  ];
  const lastColumn = columnName(headers.length - 1);
  const rowXml = records.map((record, rowIndex) =>
    `<row r="${rowIndex + 1}">${record.map((value, colIndex) =>
      cell(`${columnName(colIndex)}${rowIndex + 1}`, value, rowIndex === 0 ? 1 : 0)
    ).join("")}</row>`
  ).join("");
  const widths = [14, 26, 20, 20, 32, 36, 16, 36, 42, 20, 20, 32, 24, 30, 32, 20, 42, 28, 24, 24, 24];
  const cols = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews><sheets><sheet name="Adesioni" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17365D"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${cols}</cols><sheetData>${rowXml}</sheetData><autoFilter ref="A1:${lastColumn}${records.length}"/></worksheet>`),
  };
  return zipSync(files, { level: 6 });
}

