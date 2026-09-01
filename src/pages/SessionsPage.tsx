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
import {
  createInterviewSession,
  generateSessionSlots,
  listInterviewSessions,
  listMyAllocations,
  rotateBookingLink,
} from "../lib/data";

const schema = z.object({
  allocationId: z.string().uuid("Seleziona una fascia assegnata"),
  name: z.string().trim().min(3, "Inserisci il nome della sessione"),
  duration: z.number().int().min(5).max(180),
});

export function SessionsPage() {
  const queryClient = useQueryClient();
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const sessionsQuery = useQuery({
    queryKey: ["interview-sessions"],
    queryFn: listInterviewSessions,
  });
  const allocationsQuery = useQuery({
    queryKey: ["my-allocations"],
    queryFn: listMyAllocations,
  });
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { duration: 30 },
  });
  const createMutation = useMutation({
    mutationFn: async (values: z.infer<typeof schema>) => {
      const sessionId = await createInterviewSession(values);
      await generateSessionSlots(sessionId, values.duration);
      return sessionId;
    },
    onSuccess: async () => {
      form.reset({ duration: 30 });
      await queryClient.invalidateQueries({ queryKey: ["interview-sessions"] });
    },
  });
  const linkMutation = useMutation({
    mutationFn: rotateBookingLink,
    onSuccess: async (token) => {
      setGeneratedLink(`${window.location.origin}/book/${token}`);
      await queryClient.invalidateQueries({ queryKey: ["interview-sessions"] });
    },
  });

  return (
    <div className="page-container">
      <PageHeader
        eyebrow="Area"
        title="Sessioni e slot"
        description="Trasforma una fascia assegnata in una sessione, genera automaticamente gli slot e condividi un link privato."
      />

      <section className="panel">
        <div className="panel__header">
          <div>
            <h2>Nuova sessione</h2>
            <p>Puoi modificare i singoli slot anche dopo la generazione</p>
          </div>
          <CalendarPlus size={20} />
        </div>
        <form
          className="panel__body form-grid"
          onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}
        >
          <div className="form-field form-field--full">
            <label htmlFor="session-allocation">Fascia assegnata</label>
            <select
              id="session-allocation"
              className="select"
              defaultValue=""
              {...form.register("allocationId")}
            >
              <option value="" disabled>
                Seleziona fascia
              </option>
              {allocationsQuery.data?.map((allocation) => (
                <option value={allocation.id} key={allocation.id}>
                  {allocation.areaName} · {allocation.roomName} · {formatDateTime(allocation.startsAt)}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="session-name">Nome sessione</label>
            <input
              id="session-name"
              className="input"
              placeholder="es. Colloqui Software · 8 settembre"
              {...form.register("name")}
            />
          </div>
          <div className="form-field">
            <label htmlFor="session-duration">Durata slot in minuti</label>
            <input
              id="session-duration"
              className="input"
              type="number"
              min="5"
              max="180"
              step="5"
              {...form.register("duration", { valueAsNumber: true })}
            />
          </div>
          {createMutation.error && (
            <div className="form-error form-field--full" role="alert">
              {createMutation.error.message}
            </div>
          )}
          <div className="form-actions">
            <button
              className="button button--primary"
              type="submit"
              disabled={createMutation.isPending}
            >
              <CalendarPlus size={17} /> Crea e genera slot
            </button>
          </div>
        </form>
      </section>

      {generatedLink && (
        <section className="generated-link" aria-live="polite">
          <div>
            <p>Nuovo link privato</p>
            <strong>{generatedLink}</strong>
          </div>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void navigator.clipboard.writeText(generatedLink)}
          >
            <ClipboardCopy size={17} /> Copia
          </button>
        </section>
      )}

      <section className="panel availability-list-panel">
        <div className="panel__header">
          <div>
            <h2>Sessioni dell’area</h2>
            <p>Slot, prenotazioni e link attivi</p>
          </div>
        </div>
        <div className="panel__body panel__body--flush">
          {sessionsQuery.data?.length ? (
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Sessione</th>
                    <th>Quando</th>
                    <th>Aula</th>
                    <th>Slot</th>
                    <th>Link</th>
                    <th>Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionsQuery.data.map((session) => (
                    <tr key={session.id}>
                      <td>
                        <strong>{session.name}</strong>
                        <span className="table-secondary">{session.areaName}</span>
                      </td>
                      <td>
                        {formatDateTime(session.startsAt)}
                        <span className="table-secondary">
                          {formatTimeRange(session.startsAt, session.endsAt)}
                        </span>
                      </td>
                      <td>{session.roomName}</td>
                      <td>
                        {session.bookedSlots} prenotati · {session.availableSlots} liberi
                      </td>
                      <td>
                        <StatusBadge
                          label={session.bookingLinkActive ? "Attivo" : "Non attivo"}
                          tone={session.bookingLinkActive ? "success" : "neutral"}
                        />
                      </td>
                      <td>
                        <button
                          className="button button--secondary button--small"
                          type="button"
                          disabled={linkMutation.isPending}
                          onClick={() => linkMutation.mutate(session.id)}
                        >
                          <Link2 size={15} />
                          {session.bookingLinkActive ? "Rigenera" : "Genera"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={ListChecks}
              title="Nessuna sessione"
              description="Prima prendi una fascia dalle disponibilità, poi crea qui la sessione di colloqui."
            />
          )}
        </div>
      </section>
    </div>
  );
}
