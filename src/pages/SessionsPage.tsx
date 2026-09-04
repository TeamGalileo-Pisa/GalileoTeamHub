import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, ClipboardCopy, Link2, ListChecks } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { formatDateTime, formatTimeRange } from "../lib/dates";
import { listInterviewSessions, listMyAllocations, getAreaBookingLink } from "../lib/data";
import { rpc } from "../lib/operations";
import { SessionManager } from "../components/SessionManager";

const schema = z.object({
  allocationId: z.string().uuid("Seleziona una fascia assegnata"),
  name: z.string().trim().min(3, "Inserisci il nome della sessione"),
  duration: z.number().int().min(5).max(180),
});

export function SessionsPage() {
  const queryClient = useQueryClient();
  const [managing, setManaging] = useState<string | null>(null);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [linkFeedback, setLinkFeedback] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [createFeedback, setCreateFeedback] = useState<string | null>(null);
  const sessionsQuery = useQuery({ queryKey: ["interview-sessions"], queryFn: listInterviewSessions });
  const allocationsQuery = useQuery({ queryKey: ["my-allocations"], queryFn: listMyAllocations });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { duration: 30 } });
  const createMutation = useMutation({
    mutationFn: async (values: z.infer<typeof schema>) => rpc<string>("create_session_with_slots", {
      p_allocation_id: values.allocationId,
      p_name: values.name,
      p_duration_minutes: values.duration,
    }),
    onMutate: () => setCreateFeedback(null),
    onSuccess: async () => {
      form.reset({ duration: 30 });
      setCreateFeedback("Sessione creata e slot generati correttamente.");
      await queryClient.invalidateQueries({ queryKey: ["interview-sessions"] });
      await queryClient.invalidateQueries({ queryKey: ["my-allocations"] });
    },
  });
  const linkMutation = useMutation({
    mutationFn: getAreaBookingLink,
    onMutate: () => { setGeneratedLink(null); setLinkFeedback(null); setCopyFeedback(null); },
    onSuccess: async (token) => {
      setGeneratedLink(`${window.location.origin}/book/${token}`);
      setLinkFeedback("Link stabile dell’area: non cambia quando aggiungi o aggiorni gli slot.");
      await queryClient.invalidateQueries({ queryKey: ["interview-sessions"] });
    },
  });

  async function copyGeneratedLink() {
    if (!generatedLink) return;
    try { await navigator.clipboard.writeText(generatedLink); setCopyFeedback("Link copiato negli appunti."); }
    catch { setCopyFeedback("Copia non riuscita: seleziona e copia manualmente il link."); }
  }

  return (
    <div className="page-container">
      <PageHeader eyebrow="Area" title="Sessioni e slot" description="Trasforma una fascia assegnata in una sessione, genera automaticamente gli slot e condividi il link stabile dell’area." />
      <section className="panel">
        <div className="panel__header"><div><h2>Nuova sessione</h2><p>Puoi modificare i singoli slot anche dopo la generazione</p></div><CalendarPlus size={20} /></div>
        <form className="panel__body form-grid" onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}>
          <div className="form-field form-field--full"><label htmlFor="session-allocation">Fascia assegnata</label><select id="session-allocation" className="select" defaultValue="" {...form.register("allocationId")}><option value="" disabled>Seleziona fascia</option>{allocationsQuery.data?.map((allocation) => <option value={allocation.id} key={allocation.id}>{allocation.areaName} · {allocation.roomName} · {formatDateTime(allocation.startsAt)}</option>)}</select></div>
          <div className="form-field"><label htmlFor="session-name">Nome sessione</label><input id="session-name" className="input" placeholder="es. Colloqui Software · 8 settembre" {...form.register("name")} /></div>
          <div className="form-field"><label htmlFor="session-duration">Durata slot in minuti</label><input id="session-duration" className="input" type="number" min="5" max="180" step="5" {...form.register("duration", { valueAsNumber: true })} /></div>
          {createMutation.error && <div className="form-error form-field--full" role="alert">{createMutation.error.message}</div>}
          {Object.entries(form.formState.errors).map(([key, error]) => <span key={key} className="field-error">{error.message}</span>)}
          {createFeedback && <div className="form-success form-field--full" role="status">{createFeedback}</div>}
          <div className="form-actions"><button className="button button--primary" type="submit" disabled={createMutation.isPending}><CalendarPlus size={17} />{createMutation.isPending ? "Creazione…" : "Crea e genera slot"}</button></div>
        </form>
      </section>

      {generatedLink && <section className="generated-link" aria-live="polite"><div><p>Link stabile dell’area</p><strong>{generatedLink}</strong>{linkFeedback && <span>{linkFeedback}</span>}{copyFeedback && <span>{copyFeedback}</span>}</div><button className="button button--secondary" type="button" onClick={() => void copyGeneratedLink()}><ClipboardCopy size={17} /> Copia link</button></section>}
      {linkMutation.error && <div className="form-error page-feedback" role="alert">{linkMutation.error.message}</div>}

      <section className="panel availability-list-panel">
        <div className="panel__header"><div><h2>Sessioni dell’area</h2><p>Tutti gli slot restano raccolti nel calendario unico dell’area.</p></div></div>
        <div className="panel__body panel__body--flush">
          {sessionsQuery.data?.length ? <div className="data-table-wrapper"><table className="data-table"><thead><tr><th>Sessione</th><th>Quando</th><th>Aula</th><th>Slot</th><th>Link</th><th>Azioni</th></tr></thead><tbody>
            {sessionsQuery.data.map((session) => <tr key={session.id}>
              <td><strong>{session.name}</strong><span className="table-secondary">{session.areaName}</span></td>
              <td>{formatDateTime(session.startsAt)}<span className="table-secondary">{formatTimeRange(session.startsAt, session.endsAt)}</span></td>
              <td>{session.roomName}</td>
              <td>{session.bookedSlots} prenotati · {session.availableSlots} liberi</td>
              <td><StatusBadge label={session.bookingLinkActive ? "Attivo" : "Non attivo"} tone={session.bookingLinkActive ? "success" : "neutral"} /></td>
              <td>
                <button className="button button--primary button--small" onClick={() => setManaging(session.id)}>Gestisci</button>{" "}
                <button className="button button--secondary button--small" type="button" disabled={linkMutation.isPending} onClick={() => linkMutation.mutate(session.areaId)}><Link2 size={15} />{linkMutation.isPending && linkMutation.variables === session.areaId ? "Apertura…" : "Link area"}</button>
                {session.bookingLinkActive && <span className="table-secondary">URL: /book/area-… · include tutte le giornate e tutte le aule dell’area.</span>}
              </td>
            </tr>)}
          </tbody></table></div> : <EmptyState icon={ListChecks} title="Nessuna sessione" description="Prima prendi una fascia dalle disponibilità, poi crea qui la sessione di colloqui." />}
        </div>
      </section>
      {(sessionsQuery.error || allocationsQuery.error) && <p className="form-error" role="alert">{(sessionsQuery.error || allocationsQuery.error)?.message}</p>}
      {sessionsQuery.isLoading && <p>Caricamento sessioni…</p>}
      {managing && sessionsQuery.data?.find((s) => s.id === managing) && <SessionManager session={sessionsQuery.data.find((s) => s.id === managing)!} onClose={() => setManaging(null)} onGenerate={() => { const session = sessionsQuery.data?.find((item) => item.id === managing); if (session) linkMutation.mutate(session.areaId); setManaging(null); }} />}
    </div>
  );
}
