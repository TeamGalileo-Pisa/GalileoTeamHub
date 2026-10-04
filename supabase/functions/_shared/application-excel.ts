import { strToU8, zipSync } from "npm:fflate@0.8.2";
import { divisions } from "./application-fields.ts";

export type ApplicationExportRow = {
  firstName: string;
  lastName: string;
  email: string;
  areaName: string;
  areaSlug: string;
  answers: Record<string, unknown>;
  createdAt: string;
};

const areaQuestions = [...new Set(Object.values(divisions).map((division) => division.question))];
const columns: { key: string; label: string }[] = [
  { key: "firstName", label: "Nome" },
  { key: "lastName", label: "Cognome" },
  { key: "email", label: "Email istituzionale" },
  { key: "degree", label: "Corso di Laurea" },
  { key: "year", label: "Anno di iscrizione" },
  { key: "areaName", label: "Per quale specifica Divisione ti stai candidando?" },
  ...areaQuestions.map((question, index) => ({ key: `areaQuestion${index}`, label: question })),
  { key: "level", label: "Livello di competenza" },
  { key: "motivation", label: "Perché sei interessato/a a questo progetto?" },
  { key: "expectations", label: "Perché ti stai candidando in questa fase e cosa ti aspetti da questa esperienza?" },
  { key: "leadership", label: "Saresti disponibile ad assumere ruoli di responsabilità o di Capo Area?" },
  { key: "availability", label: "Quante ore a settimana, mediamente, pensi di poter dedicare al progetto?" },
  { key: "presence", label: "Quanto spesso puoi garantire la presenza fisica a Pisa?" },
  { key: "experience", label: "Esperienze pregresse" },
  { key: "deadlines", label: "Come gestisci solitamente le scadenze importanti o i momenti di picco di lavoro?" },
  { key: "certifications", label: "Certificazioni extra o competenze linguistiche" },
  { key: "problemSolving", label: "Di fronte a un problema tecnico o logistico senza soluzione, qual è il tuo primo istinto?" },
  { key: "projects", label: "Progetti personali" },
  { key: "privacyAccepted", label: "Consenso al trattamento dei dati per selezione e attività del Team Galileo" },
  { key: "createdAt", label: "Data di ricezione" },
];

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
  return `<c r="${reference}" t="inlineStr"${header ? ' s="1"' : ""}><is><t xml:space="preserve">${cleanXml(value)}</t></is></c>`;
}

function displayAnswer(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Sì" : "No";
  if (Array.isArray(value)) return value.map(String).join("; ");
  return String(value);
}

export function applicationExcel(applications: ApplicationExportRow[]) {
  const records = [
    columns.map((column) => column.label),
    ...applications.map((application) => {
      const answers = application.answers ?? {};
      const selectedAreaQuestion = divisions[application.areaSlug]?.question;
      const answerByKey: Record<string, unknown> = {
        firstName: application.firstName,
        lastName: application.lastName,
        email: application.email,
        degree: answers.degree,
        year: answers.year,
        areaName: application.areaName,
        level: answers.level,
        motivation: answers.motivation,
        expectations: answers.expectations,
        leadership: answers.leadership,
        availability: answers.availability,
        presence: answers.presence,
        experience: answers.experience,
        deadlines: answers.deadlines,
        certifications: answers.certifications,
        problemSolving: answers.problemSolving,
        projects: answers.projects,
        privacyAccepted: answers.privacyAccepted,
        createdAt: application.createdAt,
      };
      const skills = Array.isArray(answers.skills) ? answers.skills.map(String) : [];
      if (typeof answers.otherSkills === "string" && answers.otherSkills.trim()) {
        skills.push(`Altro: ${answers.otherSkills.trim()}`);
      }
      areaQuestions.forEach((question, index) => {
        answerByKey[`areaQuestion${index}`] = question === selectedAreaQuestion ? skills : "";
      });
      return columns.map((column) => displayAnswer(answerByKey[column.key]));
    }),
  ];
  const lastColumn = columnName(columns.length - 1);
  const rowsXml = records.map((record, rowIndex) =>
    `<row r="${rowIndex + 1}">${record.map((value, colIndex) =>
      cell(`${columnName(colIndex)}${rowIndex + 1}`, value, rowIndex === 0)
    ).join("")}</row>`
  ).join("");
  const colXml = columns.map((column, index) =>
    `<col min="${index + 1}" max="${index + 1}" width="${Math.min(44, Math.max(18, Math.ceil(column.label.length * 0.9)))}" customWidth="1"/>`
  ).join("");
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews><sheets><sheet name="Candidature" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17365D"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${colXml}</cols><sheetData>${rowsXml}</sheetData><autoFilter ref="A1:${lastColumn}${records.length}"/></worksheet>`),
  };
  return zipSync(files, { level: 6 });
}

