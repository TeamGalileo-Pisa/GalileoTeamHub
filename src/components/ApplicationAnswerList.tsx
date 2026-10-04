import { divisions, genericDivision } from "../lib/application-fields";

type ApplicationAnswers = {
  first_name: string;
  last_name: string;
  email: string;
  area_name: string;
  area_slug: string;
  answers: Record<string, unknown>;
};

function answerText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Nessuna risposta";
  if (typeof value === "boolean") return value ? "Sì" : "No";
  if (Array.isArray(value)) return value.map(String).join(", ") || "Nessuna risposta";
  if (typeof value === "object") return Object.values(value).map(String).join(", ");
  return String(value);
}

export function ApplicationAnswerList({ application }: { application: ApplicationAnswers }) {
  const answers = application.answers ?? {};
  const division = divisions[application.area_slug] ?? genericDivision;
  const fields: { question: string; answer: unknown }[] = [
    { question: "Nome", answer: application.first_name },
    { question: "Cognome", answer: application.last_name },
    { question: "Email istituzionale", answer: application.email },
    { question: "Corso di Laurea", answer: answers.degree },
    { question: "Anno di iscrizione", answer: answers.year },
    { question: "Per quale specifica Divisione ti stai candidando?", answer: application.area_name },
    {
      question: division.question,
      answer: [
        ...(Array.isArray(answers.skills) ? answers.skills : []),
        typeof answers.otherSkills === "string" && answers.otherSkills.trim()
          ? `Altro: ${answers.otherSkills.trim()}`
          : "",
      ].filter(Boolean),
    },
    { question: "Livello di competenza", answer: answers.level },
    { question: "Perché sei interessato/a a questo progetto?", answer: answers.motivation },
    { question: "Perché ti stai candidando in questa fase e cosa ti aspetti da questa esperienza?", answer: answers.expectations },
    { question: "Saresti disponibile ad assumere ruoli di responsabilità o di Capo Area?", answer: answers.leadership },
    { question: "Quante ore a settimana, mediamente, pensi di poter dedicare al progetto?", answer: answers.availability },
    { question: "Quanto spesso puoi garantire la presenza fisica a Pisa?", answer: answers.presence },
    { question: "Esperienze pregresse", answer: answers.experience },
    { question: "Come gestisci solitamente le scadenze importanti o i momenti di picco di lavoro?", answer: answers.deadlines },
    { question: "Certificazioni extra o competenze linguistiche", answer: answers.certifications },
    { question: "Di fronte a un problema tecnico o logistico senza soluzione, qual è il tuo primo istinto?", answer: answers.problemSolving },
    { question: "Progetti personali", answer: answers.projects },
    {
      question: "Acconsento al trattamento dei dati inseriti esclusivamente da parte dei promotori del Team Galileo Pisa ai fini della selezione e dell'organizzazione delle attività del team.",
      answer: answers.privacyAccepted,
    },
  ];
  const knownKeys = new Set([
    "firstName", "lastName", "email", "degree", "year", "skills", "otherSkills",
    "level", "motivation", "expectations", "leadership", "availability", "presence",
    "experience", "deadlines", "certifications", "problemSolving", "projects", "privacyAccepted",
  ]);
  for (const [key, answer] of Object.entries(answers)) {
    if (!knownKeys.has(key)) fields.push({ question: key, answer });
  }

  return <div className="application-question-list">
    {fields.map(({ question, answer }, index) => <article className="application-question" key={`${index}-${question}`}>
      <p><strong>Domanda</strong></p>
      <h3>{question}</h3>
      <p><strong>Risposta</strong></p>
      <div className="application-question__answer">{answerText(answer)}</div>
    </article>)}
  </div>;
}

