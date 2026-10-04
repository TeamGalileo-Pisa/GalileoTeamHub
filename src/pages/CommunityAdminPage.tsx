import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { community } from "../lib/community";
import { listAreas } from "../lib/data";
import { PageHeader } from "../components/PageHeader";
export function CommunityAdminPage() {
  const cache = useQueryClient();
  const [credentials, setCredentials] = useState<
    { username: string; temporaryPassword: string } | null
  >(null);
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
        answers: Record<string, unknown>;
      }[];
    },
  });
  const invitations = useQuery({
    queryKey: ["membership-invitations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("membership_invitations")
        .select("id,email,submitted_at,expires_at").order("created_at", {
          ascending: false,
        });
      if (error) throw error;
      return data as {
        id: string;
        email: string;
        submitted_at: string | null;
        expires_at: string;
      }[];
    },
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
  const invite = useMutation({
    mutationFn: (f: FormData) =>
      community({
        action: "invite",
        email: f.get("email"),
        areaId: f.get("areaId"),
      }),
    onSuccess: () =>
      cache.invalidateQueries({ queryKey: ["membership-invitations"] }),
  });
  const member = useMutation({
    mutationFn: (areaId: string) =>
      community<{ username: string; temporaryPassword: string }>({
        action: "create_member",
        areaId,
      }),
    onSuccess: setCredentials,
  });
  const error = deliveries.error ?? settings.error ?? controls.error ??
    applications.error ?? invitations.error ?? toggle.error ?? invite.error ??
    member.error;
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
        <h2>Invia il modulo di adesione</h2>
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate(new FormData(e.currentTarget));
          }}
        >
          <label className="form-field">
            Email del membro<input
              className="input"
              name="email"
              type="email"
              required
            />
          </label>
          <label className="form-field">
            Area assegnata<select
              className="select"
              name="areaId"
              required
              defaultValue=""
            >
              <option value="">Seleziona area</option>
              {areas.data?.filter((a) => a.active).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
          <button
            className="button button--primary"
            disabled={invite.isPending}
          >
            Invia invito personale
          </button>
          {invite.isSuccess && (
            <p role="status">Invito accodato per l'invio email.</p>
          )}
        </form>
        <ul>
          {invitations.data?.map((i) => (
            <li key={i.id}>
              {i.email} · {i.submitted_at
                ? "Compilato"
                : new Date(i.expires_at) < new Date()
                ? "Scaduto"
                : "In attesa"}
            </li>
          ))}
        </ul>
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
        {applications.data?.map((a) => (
          <details key={a.id}>
            <summary>
              {a.first_name} {a.last_name} ·{" "}
              {areas.data?.find((x) => x.id === a.area_id)?.name}
            </summary>
            <p>{a.email}</p>
            <dl>
              {Object.entries(a.answers).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{Array.isArray(v) ? v.join(", ") : String(v)}</dd>
                </div>
              ))}
            </dl>
          </details>
        ))}
      </section>
    </div>
  );
}
