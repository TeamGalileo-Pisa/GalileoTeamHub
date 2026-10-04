export const membershipAreas = [
  "Mobility Division",
  "Manipulation Division",
  "Electronics, RF & Power Supply Division",
  "Software, Nav & Controls Division",
  "Geology Division",
  "Life Detection Division",
  "Business Area",
  "Marketing & Comm. Area",
  "Logistics Area",
  "Direzione tecnica/Responsabile",
] as const;

export const membershipLeadershipRoles = [
  "Team Leader",
  "Engineering Director",
  "Science Director",
  "Head of Mobility Division",
  "Head of Manipulation Division",
  "Head of Electronics, RF & Power Supply Division",
  "Head of Software, Nav & Controls Division",
  "Head of Geology Division",
  "Head of Life Detection Division",
  "Head of Business Area",
  "Head of Marketing & Comm. Area",
  "Head of Logistics Area",
] as const;

export const membershipCommitments = [
  "Rispettare le norme di sicurezza e comportamento prescritte nei regolamenti di Ateneo ed elaborati tecnici (misure di emergenza, uso spazi operativi e procedure interne del Team Galileo);",
  "Rispettare le disponibilità dichiarate, le scadenze operative, la comunicazione interna (consultazione quotidiana dei canali di lavoro) e aggiornare costantemente i Teams sullo stato d'avanzamento dei progetti;",
  "Rispettare i vincoli gestionali ed economico-patrimoniali, ottenendo preventiva autorizzazione scritta (Team Leader/Faculty Advisor) per ogni spesa o impegno finanziario, e astenendosi dall'asportare materiali o componenti dell'Ateneo;",
  "Utilizzare le risorse informatiche (account, cloud, licenze software) con diligenza, riservatezza ed esclusivamente per fini istituzionali correlati ai progetti del Team;",
  "Tutelare l'immagine del Team, previa autorizzazione della Communication Area prima della diffusione di materiali o contenuti digitali, e indossando il vestiario ufficiale esclusivamente in contesti autorizzati;",
  "Seguire la procedura corretta in caso di recesso, garantendo la riconsegna di beni/licenze, l'affiancamento del subentrante e la consegna della documentazione tecnica.",
] as const;

export const membershipAnswerKeys = [
  "firstName",
  "lastName",
  "degree",
  "department",
  "studentNumber",
  "area",
  "leadershipRole",
  "commitmentsAccepted",
  "internalRegulationAccepted",
  "ipAccepted",
  "selfCertificationAccepted",
  "gdprAccepted",
  "institutionalEmail",
  "phone",
  "linkedin",
  "privacyAccepted",
] as const;

export type MembershipAnswers = Partial<Record<typeof membershipAnswerKeys[number], string>>;

export function normalizeMembershipAnswers(value: unknown): MembershipAnswers {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const answers: MembershipAnswers = {};
  for (const key of membershipAnswerKeys) {
    if (typeof source[key] === "string") answers[key] = source[key] as string;
  }
  if (answers.area !== "Direzione tecnica/Responsabile") answers.leadershipRole = "";
  return answers;
}

