import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Trash2 } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { ApplicationAnswerList } from "../components/ApplicationAnswerList";
import { community } from "../lib/community";
import { downloadApplicationsExport } from "../lib/application-export";
import { useAuth } from "../hooks/useAuth";

type Application = {
  id: string; first_name: string; last_name: string; email: string;
  area_id: string; area_name: string; area_slug: string;
  answers: Record<string, unknown>; created_at: string;
};

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
  const exportApplications = useMutation({ mutationFn: downloadApplicationsExport });

  return <div className="page-container">
    <PageHeader title="Candidature" eyebrow="Revisione riservata" description="Consulta le candidature in ordine di domanda. I capi area vedono solo le candidature delle proprie aree; Team Leader, amministrazione e logistica possono consultare tutte le aree." />
    <div className="page-actions">
      <button className="button button--secondary" type="button" disabled={exportApplications.isPending} onClick={() => exportApplications.mutate()}>
        <Download size={16} /> {exportApplications.isPending ? "Preparo l’Excel…" : "Scarica candidature Excel"}
      </button>
    </div>
    {exportApplications.error && <p className="form-error" role="alert">{exportApplications.error.message}</p>}
    {exportApplications.isSuccess && <p className="form-success" role="status">Excel candidature scaricato.</p>}
    {applications.isLoading && <p>Caricamento candidature…</p>}
    {applications.error && <p className="form-error" role="alert">{applications.error.message}</p>}
    {deleteApplication.error && <p className="form-error" role="alert">{deleteApplication.error.message}</p>}
    {!applications.isLoading && applications.data?.length === 0 && <section className="panel panel__body"><p>Non ci sono candidature disponibili.</p></section>}
    {applications.data?.map((application) => {
      return <section className="panel application-review-card" key={application.id}>
        <header className="application-review-card__header">
          <details className="application-disclosure">
            <summary>
              <span className="application-disclosure__name">{application.first_name} {application.last_name}</span>
              <span className="application-disclosure__hint">{application.area_name} · Apri le risposte</span>
            </summary>
            <p className="application-disclosure__meta">{application.email} · Ricevuta il {new Date(application.created_at).toLocaleString("it-IT")}</p>
            <ApplicationAnswerList application={application} />
          </details>
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
      </section>;
    })}
  </div>;
}

