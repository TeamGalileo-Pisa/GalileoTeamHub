import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { InterviewSession } from "../types/domain";
import { formatDateTime, formatTimeRange } from "../lib/dates";
import {
  cancelSession,
  deleteSessionPermanently,
  deleteSlotPermanently,
} from "../lib/hub-enhancements";
import { rpc } from "../lib/operations";
import { romeInputToIso, toRomeInput } from "../lib/scheduling";
import { CancelDeleteDialog } from "./CancelDeleteDialog";
import { Modal } from "./Modal";

interface Slot {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  booked: boolean;
  has_history: boolean;
}

export function SessionManager({
  session,
  onClose,
  onGenerate,
}: {
  session: InterviewSession;
  onClose: () => void;
  onGenerate: () => void;
}) {
  const cache = useQueryClient();
  const [name, setName] = useState(session.name);
  const [message, setMessage] = useState("");
  const [lifecycleOpen, setLifecycleOpen] = useState(false);
  const query = useQuery({
    queryKey: ["session-slots", session.id],
    queryFn: () => rpc<Slot[]>("list_session_slots", { p_session_id: session.id }),
  });
  const mutation = useMutation({
    mutationFn: (action: string) =>
      rpc("manage_session", {
        p_session_id: session.id,
        p_action: action,
        p_name: name,
      }),
    onSuccess: async () => {
      setMessage("Sessione aggiornata.");
      await cache.invalidateQueries();
    },
  });
  const lifecycleMutation = useMutation({
    mutationFn: (action: "cancel" | "delete") =>
      action === "cancel"
        ? cancelSession(session.id)
        : deleteSessionPermanently(session.id),
    onSuccess: async () => {
      await cache.invalidateQueries();
      onClose();
    },
  });
  const closed = session.status === "closed" || session.status === "cancelled";
  const pending = mutation.isPending || lifecycleMutation.isPending;

  return (
    <Modal title={`Gestisci · ${session.name}`} onClose={() => { if (!pending) onClose(); }}>
      <p>
        {session.areaName} · {session.roomName} · {formatDateTime(session.startsAt)} · {formatTimeRange(session.startsAt, session.endsAt)}
      </p>
      <p>
        Stato: {session.status === "closed"
          ? "Chiusa"
          : session.status === "cancelled"
            ? "Annullata"
            : session.status === "published"
              ? "Pubblicata"
              : "Bozza"}
      </p>

      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate("rename");
        }}
      >
        <label className="form-field form-field--full">
          Nome sessione
          <input
            className="input"
            required
            minLength={3}
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button className="button button--secondary" disabled={pending}>Salva nome</button>
      </form>

      <div className="table-actions">
        <button className="button button--secondary" disabled={closed || pending} onClick={onGenerate}>
          Genera / rigenera link
        </button>
        <button
          className="button button--secondary"
          disabled={pending || !session.bookingLinkActive}
          onClick={() => mutation.mutate("revoke_link")}
        >
          Revoca link
        </button>
        {closed ? (
          <button
            className="button button--secondary"
            disabled={session.status === "cancelled" || pending}
            onClick={() => mutation.mutate("reopen")}
          >
            Riapri sessione
          </button>
        ) : (
          <button
            className="button button--secondary"
            disabled={pending}
            onClick={() => {
              if (window.confirm("Chiudere la sessione? Link e slot liberi verranno disattivati. Le prenotazioni restano confermate.")) {
                mutation.mutate("close");
              }
            }}
          >
            Chiudi sessione
          </button>
        )}
        <button
          className="button button--danger"
          disabled={pending}
          onClick={() => {
            if (session.status === "cancelled") {
              if (window.confirm("Questa sessione è già annullata. Vuoi eliminarla definitivamente insieme ai dati di scheduling collegati? L'operazione non è recuperabile.")) {
                lifecycleMutation.mutate("delete");
              }
            } else {
              setLifecycleOpen(true);
            }
          }}
        >
          {session.status === "cancelled" ? "Elimina definitivamente" : "Annulla sessione…"}
        </button>
      </div>

      {message && <p className="form-success" role="status">{message}</p>}
      {(mutation.error || lifecycleMutation.error || query.error) && (
        <p className="form-error" role="alert">
          {(mutation.error || lifecycleMutation.error || query.error)?.message}
        </p>
      )}

      <h3>Slot della sessione</h3>
      <p className="field-help">
        Gli appuntamenti confermati si gestiscono dal Calendario. Gli slot liberi possono essere modificati o chiusi; l'eliminazione definitiva rimuove anche l'eventuale storico annullato collegato allo slot e non è recuperabile.
      </p>
      {query.isLoading ? (
        <p>Caricamento slot…</p>
      ) : query.data?.length ? (
        query.data.map((slot) => (
          <SlotEditor key={`${slot.id}-${slot.starts_at}-${slot.status}`} slot={slot} session={session} />
        ))
      ) : (
        <p>Nessuno slot presente.</p>
      )}

      {lifecycleOpen && (
        <CancelDeleteDialog
          title="Come vuoi annullare la sessione?"
          description="Annullando e conservando, la sessione resta visibile nello storico; le prenotazioni confermate vengono annullate, gli slot vengono chiusi e la fascia dell'area viene liberata. Con l'eliminazione definitiva vengono rimossi sessione, slot, prenotazioni e dati di scheduling collegati."
          itemLabel="La sessione"
          pending={lifecycleMutation.isPending}
          error={lifecycleMutation.error?.message}
          onClose={() => setLifecycleOpen(false)}
          onCancelOnly={() => lifecycleMutation.mutate("cancel")}
          onCancelAndDelete={() => lifecycleMutation.mutate("delete")}
        />
      )}
    </Modal>
  );
}

function SlotEditor({ slot, session }: { slot: Slot; session: InterviewSession }) {
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(toRomeInput(slot.starts_at));
  const [end, setEnd] = useState(toRomeInput(slot.ends_at));
  const cache = useQueryClient();
  const mutation = useMutation({
    mutationFn: (action: string) =>
      rpc("manage_slot", {
        p_slot_id: slot.id,
        p_action: action,
        p_starts_at: action === "edit" ? romeInputToIso(start) : null,
        p_ends_at: action === "edit" ? romeInputToIso(end) : null,
      }),
    onSuccess: async () => {
      setEditing(false);
      await cache.invalidateQueries();
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteSlotPermanently(slot.id),
    onSuccess: async () => {
      setEditing(false);
      await cache.invalidateQueries();
    },
  });
  const closed = ["closed", "cancelled"].includes(session.status);
  const pending = mutation.isPending || deleteMutation.isPending;

  return (
    <section className="slot-editor">
      <strong>
        {formatTimeRange(slot.starts_at, slot.ends_at)} · {slot.booked
          ? "Prenotato"
          : slot.status === "disabled"
            ? "Chiuso"
            : "Libero"}
      </strong>
      {!slot.booked && (
        <div className="table-actions">
          <button
            className="button button--secondary button--small"
            disabled={slot.has_history || closed || pending}
            onClick={() => setEditing(!editing)}
          >
            Modifica orario
          </button>
          <button
            className="button button--secondary button--small"
            disabled={pending || (slot.status === "disabled" && closed)}
            onClick={() => mutation.mutate(slot.status === "disabled" ? "reopen" : "close")}
          >
            {slot.status === "disabled" ? "Riapri" : "Chiudi slot"}
          </button>
          <button
            className="button button--danger button--small"
            disabled={pending}
            onClick={() => {
              if (window.confirm("Eliminare definitivamente questo slot? Eventuali prenotazioni già annullate collegate allo slot saranno rimosse dallo storico. L'operazione non è recuperabile.")) {
                deleteMutation.mutate();
              }
            }}
          >
            Elimina definitivamente
          </button>
        </div>
      )}

      {editing && (
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate("edit");
          }}
        >
          <label>
            Inizio
            <input
              required
              className="input"
              type="datetime-local"
              min={toRomeInput(session.startsAt)}
              max={toRomeInput(session.endsAt)}
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <label>
            Fine
            <input
              required
              className="input"
              type="datetime-local"
              min={start}
              max={toRomeInput(session.endsAt)}
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
          <button className="button button--primary" disabled={pending}>Salva orario</button>
        </form>
      )}
      {(mutation.error || deleteMutation.error) && (
        <p className="form-error" role="alert">{(mutation.error || deleteMutation.error)?.message}</p>
      )}
    </section>
  );
}
