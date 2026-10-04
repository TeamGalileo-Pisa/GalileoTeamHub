import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader";
import { community } from "../lib/community";
import { useAuth } from "../hooks/useAuth";

type Application = {
  id: string; first_name: string; last_name: string; email: string;
  area_id: string; area_name: string; answers: Record<string, unknown>; created_at: string;
};

export function ApplicationsReviewPage() {
  const { access } = useAuth();
  const applications = useQuery({
    queryKey: ["review-applications", access?.userId],
    queryFn: () => community<Application[]>({ action: "list_applications" }),
    enabled: Boolean(access),
  });
  return <div className="page-container">
    <PageHeader title="Candidature" eyebrow="Revisione riservata" description="Consulta i dati e le risposte ricevute. I capi area vedono solo le candidature delle proprie aree; Team Leader, amministrazione e logistica possono consultare tutte le aree." />
    {applications.isLoading && <p>Caricamento candidature…</p>}
    {applications.error && <p className="form-error" role="alert">{applications.error.message}</p>}
    {!applications.isLoading && applications.data?.length === 0 && <section className="panel panel__body"><p>Non ci sono candidature disponibili.</p></section>}
    {applications.data?.map((application) => <section className="panel panel__body" key={application.id}>
      <h2>{application.first_name} {application.last_name} · {application.area_name}</h2>
      <p><a href={`mailto:${encodeURIComponent(application.email)}`}>{application.email}</a> · {new Date(application.created_at).toLocaleString("it-IT")}</p>
      <dl>{Object.entries(application.answers).map(([key, value]) => <div key={key}>
        <dt>{key}</dt>
        <dd>{Array.isArray(value) ? value.map(String).join(", ") : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)}</dd>
      </div>)}</dl>
    </section>)}
  </div>;
}

