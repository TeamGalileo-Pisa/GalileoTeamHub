import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Modal } from "./Modal";
import { rpc } from "../lib/operations";
import { formatDateTime, formatTimeRange } from "../lib/dates";
import { romeInputToIso, toRomeInput } from "../lib/scheduling";
import type { InterviewSession } from "../types/domain";

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
  const query = useQuery({
    queryKey: ["session-slots", session.id],
    queryFn: () =>
      rpc<Slot[]>("list_session_slots", { p_session_id: session.id }),
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
  const closed = session.status === "closed" || session.status === "cancelled";
  return (
    <Modal title={`Gestisci · ${session.name}`} onClose={onClose}>
      <p>
        {session.areaName} · {session.roomName} ·{" "}
        {formatDateTime(session.startsAt)} ·{" "}
        {formatTimeRange(session.startsAt, session.endsAt)}
      </p>
      <p>
        Stato:{" "}
        {session.status === "closed"
          ? "Chiusa"
          : session.status === "cancelled"
            ? "Annullata"
            : session.status === "published"
              ? "Pubblicata"
              : "Bozza"}
      </p>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
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
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button
          className="button button--secondary"
          disabled={mutation.isPending}
        >
          Salva nome
        </button>
      </form>
      <div className="table-actions">
        <button
          className="button button--secondary"
          disabled={closed || mutation.isPending}
          onClick={onGenerate}
        >
          Genera / rigenera link
        </button>
        <button
          className="button button--secondary"
          disabled={mutation.isPending || !session.bookingLinkActive}
          onClick={() => mutation.mutate("revoke_link")}
        >
          Revoca link
        </button>
        {closed ? (
          <button
            className="button button--secondary"
            disabled={session.status === "cancelled" || mutation.isPending}
            onClick={() => mutation.mutate("reopen")}
          >
            Riapri sessione
          </button>
        ) : (
          <button
            className="button button--danger"
            disabled={mutation.isPending}
            onClick={() => {
              if (
                window.confirm(
                  "Chiudere la sessione? Link e slot liberi verranno disattivati. Le prenotazioni restano confermate.",
                )
              )
                mutation.mutate("close");
            }}
          >
            Chiudi sessione
          </button>
        )}
      </div>
      {message && (
        <p className="form-success" role="status">
          {message}
        </p>
      )}
      {(mutation.error || query.error) && (
        <p className="form-error" role="alert">
          {(mutation.error || query.error)?.message}
        </p>
      )}
      <h3>Slot della sessione</h3>
      <p className="field-help">
        Gli slot con storico non si spostano né si eliminano. Per gli
        appuntamenti confermati usa il Calendario. Riaprire una sessione non
        riattiva automaticamente slot o link.
      </p>
      {query.isLoading ? (
        <p>Caricamento slot…</p>
      ) : query.data?.length ? (
        query.data.map((slot) => (
          <SlotEditor
            key={`${slot.id}-${slot.starts_at}-${slot.status}`}
            slot={slot}
            session={session}
          />
        ))
      ) : (
        <p>Nessuno slot presente.</p>
      )}
    </Modal>
  );
}
function SlotEditor({
  slot,
  session,
}: {
  slot: Slot;
  session: InterviewSession;
}) {
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
  const closed = ["closed", "cancelled"].includes(session.status);
  return (
    <section className="slot-editor">
      <strong>
        {formatTimeRange(slot.starts_at, slot.ends_at)} ·{" "}
        {slot.booked
          ? "Prenotato"
          : slot.status === "disabled"
            ? "Chiuso"
            : "Libero"}
      </strong>
      {!slot.booked && (
        <div className="table-actions">
          <button
            className="button button--secondary button--small"
            disabled={slot.has_history || closed || mutation.isPending}
            onClick={() => setEditing(!editing)}
          >
            Modifica orario
          </button>
          <button
            className="button button--secondary button--small"
            disabled={
              mutation.isPending || (slot.status === "disabled" && closed)
            }
            onClick={() =>
              mutation.mutate(slot.status === "disabled" ? "reopen" : "close")
            }
          >
            {slot.status === "disabled" ? "Riapri" : "Chiudi slot"}
          </button>
          <button
            className="button button--danger button--small"
            disabled={slot.has_history || mutation.isPending}
            onClick={() => {
              if (
                window.confirm(
                  "Eliminare definitivamente questo slot mai prenotato?",
                )
              )
                mutation.mutate("delete");
            }}
          >
            Elimina
          </button>
        </div>
      )}
      {editing && (
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
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
              onChange={(e) => setStart(e.target.value)}
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
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          <button
            className="button button--primary"
            disabled={mutation.isPending}
          >
            Salva orario
          </button>
        </form>
      )}
      {mutation.error && (
        <p className="form-error" role="alert">
          {mutation.error.message}
        </p>
      )}
    </section>
  );
}
