import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { community } from "../lib/community";
import { listAreas } from "../lib/data";
import { downloadMembershipExport } from "../lib/membership-export";
import { PageHeader } from "../components/PageHeader";
import { ApplicationAnswerList } from "../components/ApplicationAnswerList";
import { Download, Search, Trash2 } from "lucide-react";
import { downloadApplicationsExport } from "../lib/application-export";
export function CommunityAdminPage() {
  const cache = useQueryClient();
  const [credentials, setCredentials] = useState<
    { username: string; temporaryPassword: string } | null
  >(null);
  const [applicationSearch, setApplicationSearch] = useState("");
  const [applicationArea, setApplicationArea] = useState("all");
  const areas = useQuery({ queryKey: ["areas"], queryFn: listAreas });
  const settings = useQuery({
    queryKey: ["application-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("application_settings")
        .select("*").single();
      if (error) throw error;
      return data as { is_open: boolean };
    },
  });
  const controls = useQuery({
    queryKey: ["application-controls"],
    queryFn: async () => {
      const { data, error } = await supabase.from("application_areas").select(
        "*",
      );
      if (error) throw error;
      return data as { area_id: string; is_open: boolean }[];
    },
  });
  const applications = useQuery({
    queryKey: ["applications"],
    queryFn: async () => {
      const { data, error } = await supabase.from("applications").select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as {
        id: string;
        first_name: string;
        last_name: string;
        email: string;
        area_id: string;
        created_at: string;
        answers: Record<string, unknown>;
      }[];
    },
  });
  const applicationAreas = useMemo(() => [...new Set((applications.data ?? []).map((application) =>
    areas.data?.find((area) => area.id === application.area_id)?.name ?? "Area"
  ))].sort((a, b) => a.localeCompare(b, "it")), [applications.data, areas.data]);
  const filteredApplications = (applications.data ?? []).filter((application) => {
    const areaName = areas.data?.find((area) => area.id === application.area_id)?.name ?? "Area";
    const phrase = `${application.first_name} ${application.last_name} ${application.email} ${areaName}`.toLocaleLowerCase("it");
    return (applicationArea === "all" || applicationArea === areaName) && phrase.includes(applicationSearch.trim().toLocaleLowerCase("it"));
  });
  const deliveries = useQuery({
    queryKey: ["community-mail"],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase.from("community_outbox").select(
        "id,kind,recipient,state,attempts,last_error,created_at",
      ).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data as {
        id: string;
        recipient: string;
        state: string;
        last_error: string | null;
      }[];
    },
  });
  const toggle = useMutation({
    mutationFn: async ({ id, open }: { id?: string; open: boolean }) => {
      const { error } = id
        ? await supabase.from("application_areas").update({ is_open: open }).eq(
          "area_id",
          id,
        )
        : await supabase.from("application_settings").update({ is_open: open })
          .eq("id", true);
      if (error) throw error;
    },
    onSuccess: () => cache.invalidateQueries(),
  });
  const [membershipLink, setMembershipLink] = useState("");
  const sharedLink = useMutation({
    mutationFn: () => community<{ url: string }>({
      action: "get_membership_form_link",
    }),
    onSuccess: ({ url }) => setMembershipLink(url),
  });
  const member = useMutation({
    mutationFn: (areaId: string) =>
      community<{ username: string; temporaryPassword: string }>({
        action: "create_member",
        areaId,
      }),
    onSuccess: setCredentials,
  });
  const exportMembership = useMutation({
    mutationFn: downloadMembershipExport,
  });
  const deleteResponses = useMutation({
    mutationFn: () => community({ action: "delete_membership_responses", confirm: true }),
    onSuccess: () => exportMembership.reset(),
  });
  const exportApplications = useMutation({ mutationFn: downloadApplicationsExport });
  const deleteApplication = useMutation({
    mutationFn: (id: string) => community({ action: "delete_application", applicationId: id }),
    onSuccess: () => cache.invalidateQueries({ queryKey: ["applications"] }),
  });
  const error = deliveries.error ?? settings.error ?? controls.error ??
    applications.error ?? toggle.error ?? sharedLink.error ??
    member.error ?? exportMembership.error ?? deleteApplication.error ??
    deleteResponses.error;
  return (
    <div className="page-container">
      <PageHeader
        title="Candidature e adesioni"
        eyebrow="Team Leader · Amministrazione"
        description="Gestisci il form pubblico, le adesioni e gli account condivisi delle aree."
      />
      {error && <p className="form-error" role="alert">{error.message}</p>}
      <section className="panel panel__body">
        <h2>Form candidature</h2>
        <p>
          <a href="/candidature" target="_blank" rel="noreferrer">
            Apri il form pubblico
          </a>
        </p>
        <label>
          <input
            type="checkbox"
            checked={settings.data?.is_open ?? false}
            disabled={!settings.data || toggle.isPending}
            onChange={(e) => toggle.mutate({ open: e.target.checked })}
          />{" "}
          Candidature aperte globalmente
        </label>
        <p>
          La chiusura globale sospende tutte le aree; alla riapertura valgono le
          scelte sottostanti.
        </p>
        {areas.data?.filter((a) => a.active).map((a) => (
          <div key={a.id} style={{ padding: 10 }}>
            <label>
              <input
                type="checkbox"
                checked={controls.data?.find((c) =>
                  c.area_id === a.id
                )
                  ?.is_open ?? false}
                disabled={toggle.isPending ||
                  !controls.data?.some((c) => c.area_id === a.id)}
                onChange={(e) =>
                  toggle.mutate({ id: a.id, open: e.target.checked })}
              />{" "}
              {a.name}
            </label>
          </div>
        ))}
      </section>
      <section className="panel panel__body">
        <h2>Link pubblico al modulo di adesione</h2>
        <p>
          Condividi lo stesso link con tutti i membri. Ognuno sceglie la propria
          area, compila il modulo e riceve via email il PDF personale da stampare,
          firmare e consegnare. Le bozze vengono salvate e ogni compilazione resta
          separata nell'Excel.
        </p>
        <button
          className="button button--primary"
          type="button"
          disabled={sharedLink.isPending}
          onClick={() => sharedLink.mutate()}
        >
          {sharedLink.isPending ? "Caricamento link…" : "Mostra link condivisibile"}
        </button>
        {membershipLink && (
          <div className="generated-link" aria-live="polite">
            <p>Link pubblico unico</p>
            <a href={membershipLink} target="_blank" rel="noreferrer">{membershipLink}</a>
            <button
              className="button button--secondary button--small"
              type="button"
              onClick={() => void navigator.clipboard?.writeText(membershipLink)}
            >
              Copia link
            </button>
          </div>
        )}
        {sharedLink.error && <p role="alert" className="form-error">{sharedLink.error.message}</p>}
        <button
          className="button button--secondary"
          type="button"
          disabled={exportMembership.isPending}
          onClick={() => exportMembership.mutate()}
        >
          {exportMembership.isPending ? "Preparazione Excel…" : "Scarica Excel adesioni"}
        </button>
        {exportMembership.isSuccess && <p role="status">File Excel scaricato.</p>}
        <button
          className="button button--danger"
          type="button"
          disabled={deleteResponses.isPending}
          onClick={() => {
            if (window.confirm("Eliminare definitivamente tutte le risposte ricevute dal link pubblico del modulo di adesione? Usa questa funzione per le prove. Questa operazione non può essere annullata.")) {
              deleteResponses.mutate();
            }
          }}
        >
          {deleteResponses.isPending ? "Eliminazione…" : "Elimina risposte ricevute (prove)"}
        </button>
        {deleteResponses.isSuccess && <p role="status">Risposte eliminate.</p>}
      </section>
      <section className="panel panel__body">
        <h2>Account membri per area</h2>
        <p>
          Un account condiviso per area, con accesso alla bacheca della propria
          area. La password iniziale appare soltanto alla creazione.
        </p>
        {areas.data?.filter((a) => a.active).map((a) => (
          <button
            style={{ margin: 6 }}
            key={a.id}
            className="button button--secondary"
            disabled={member.isPending}
            onClick={() => member.mutate(a.id)}
          >
            Crea membri {a.name}
          </button>
        ))}
        {credentials && (
          <div role="status" className="form-success">
            <p>
              Username: <strong>{credentials.username}</strong>
            </p>
            <p>
              Password temporanea: <code>{credentials.temporaryPassword}</code>
            </p>
            <p>
              Salvala e comunicala ai membri dell'area. Al primo accesso dovrà
              essere cambiata.
            </p>
            <button
              className="button button--secondary"
              onClick={() => setCredentials(null)}
            >
              Nascondi credenziali
            </button>
          </div>
        )}
      </section>
      <section className="panel panel__body">
        <h2>Stato invio email</h2>
        <p>
          Il worker elabora la coda automaticamente. Gli errori OAuth richiedono
          il ripristino della configurazione Gmail.
        </p>
        <ul>
          {deliveries.data?.map((d) => (
            <li key={d.id}>
              {d.recipient} · {d.state === "sent"
                ? "Inviata"
                : d.state === "failed"
                ? "Errore"
                : d.state === "sending"
                ? "Invio in corso"
                : "In coda"}
              {d.last_error ? " · " + d.last_error : ""}
            </li>
          ))}
        </ul>
      </section>
      <section className="panel panel__body">
        <h2>Candidature ricevute</h2>
        <p>Scarica tutte le candidature accessibili in un file Excel: una persona per riga e una domanda per colonna.</p>
        <button className="button button--secondary" type="button" disabled={exportApplications.isPending} onClick={() => exportApplications.mutate()}>
          <Download size={16} /> {exportApplications.isPending ? "Preparo l’Excel…" : "Scarica candidature Excel"}
        </button>
        {exportApplications.error && <p className="form-error" role="alert">{exportApplications.error.message}</p>}
        {exportApplications.isSuccess && <p className="form-success" role="status">Excel candidature scaricato.</p>}
        <div className="application-review-tools panel" aria-label="Filtra candidature">
          <label className="application-search"><span>Cerca candidato</span><span className="application-search__input"><Search size={17} aria-hidden="true" /><input value={applicationSearch} onChange={(event) => setApplicationSearch(event.target.value)} placeholder="Nome, cognome o email" /></span></label>
          {applicationAreas.length > 1 && <label className="application-area-filter"><span>Area</span><select value={applicationArea} onChange={(event) => setApplicationArea(event.target.value)}><option value="all">Tutte le aree</option>{applicationAreas.map((area) => <option key={area}>{area}</option>)}</select></label>}
          <p className="application-result-count">{filteredApplications.length} {filteredApplications.length === 1 ? "candidatura" : "candidature"}</p>
        </div>
        {filteredApplications.map((a) => (
          <article className="panel application-review-card" key={a.id}>
            <header className="application-review-card__header">
              <details className="application-disclosure">
                <summary>
                  <span className="application-disclosure__name">{a.first_name} {a.last_name}</span>
                  <span className="application-disclosure__hint">{areas.data?.find((x) => x.id === a.area_id)?.name ?? "Area"} · Apri le risposte</span>
                </summary>
                <p className="application-disclosure__meta"><a href={`mailto:${encodeURIComponent(a.email)}`}>{a.email}</a> · Ricevuta il {new Date(a.created_at).toLocaleString("it-IT")}</p>
                <ApplicationAnswerList application={{
                  first_name: a.first_name,
                  last_name: a.last_name,
                  email: a.email,
                  area_name: areas.data?.find((x) => x.id === a.area_id)?.name ?? "Area",
                  area_slug: areas.data?.find((x) => x.id === a.area_id)?.slug ?? "",
                  answers: a.answers,
                }} />
              </details>
              <button className="button button--danger button--small" type="button" disabled={deleteApplication.isPending} onClick={() => {
                if (window.confirm(`Eliminare definitivamente la candidatura di ${a.first_name} ${a.last_name}? Questa operazione non può essere annullata.`)) {
                  deleteApplication.mutate(a.id);
                }
              }}><Trash2 size={15} /> Elimina candidatura</button>
            </header>
          </article>
        ))}
      </section>
    </div>
  );
}
