import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { community } from "../lib/community";
import { useAuth } from "../hooks/useAuth";
import { divisions, genericDivision } from "../lib/application-fields";

type Application = {
  id: string; first_name: string; last_name: string; email: string;
  area_id: string; area_name: string; area_slug: string;
  answers: Record<string, unknown>; created_at: string;
};

function answerText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Nessuna risposta";
  if (typeof value === "boolean") return value ? "Sì" : "No";
  if (Array.isArray(value)) return value.map(String).join(", ") || "Nessuna risposta";
  if (typeof value === "object") return Object.values(value).map(String).join(", ");
  return String(value);
}

export function ApplicationsReviewPage() {
  const { access } = useAuth();
  const queryClient = useQueryClient();
  const applications = useQuery({
    queryKey: ["review-applications", access?.userId],
    queryFn: () => community<Application[]>({ action: "list_applications" }),
    enabled: Boolean(access),
  });
  const deleteApplication = useMutation({
    mutationFn: (id: string) => community({ action: "delete_application", applicationId: id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["review-applications"] }),
  });

  return <div className="page-container">
    <PageHeader title="Candidature" eyebrow="Revisione riservata" description="Consulta i dati e le risposte ricevute. I capi area vedono solo le candidature delle proprie aree; Team Leader, amministrazione e logistica possono consultare tutte le aree." />
    {applications.isLoading && <p>Caricamento candidature…</p>}
    {applications.error && <p className="form-error" role="alert">{applications.error.message}</p>}
    {deleteApplication.error && <p className="form-error" role="alert">{deleteApplication.error.message}</p>}
    {!applications.isLoading && applications.data?.length === 0 && <section className="panel panel__body"><p>Non ci sono candidature disponibili.</p></section>}
    {applications.data?.map((application) => {
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
        { question: "Consenso al trattamento dei dati", answer: answers.privacyAccepted },
      ];

      return <section className="panel application-review-card" key={application.id}>
        <header className="application-review-card__header">
          <div>
            <p className="eyebrow">{application.area_name}</p>
            <h2>{application.first_name} {application.last_name}</h2>
            <p><a href={`mailto:${encodeURIComponent(application.email)}`}>{application.email}</a> · Ricevuta il {new Date(application.created_at).toLocaleString("it-IT")}</p>
          </div>
          <button
            className="button button--danger button--small"
            type="button"
            disabled={deleteApplication.isPending}
            onClick={() => {
              if (window.confirm(`Eliminare definitivamente la candidatura di ${application.first_name} ${application.last_name}? Questa operazione non può essere annullata.`)) {
                deleteApplication.mutate(application.id);
              }
            }}
          ><Trash2 size={15} /> Elimina candidatura</button>
        </header>
        <div className="application-question-list">
          {fields.map(({ question, answer }, index) => <article className="application-question" key={`${index}-${question}`}>
            <p><strong>Domanda</strong></p>
            <h3>{question}</h3>
            <p><strong>Risposta</strong></p>
            <div className="application-question__answer">{answerText(answer)}</div>
          </article>)}
        </div>
      </section>;
    })}
  </div>;
}
