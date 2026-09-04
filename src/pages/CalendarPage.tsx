import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CancelDeleteDialog } from "../components/CancelDeleteDialog";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../hooks/useAuth";
import { listAreas } from "../lib/data";
import {
  formatBookingDay,
  formatDateTime,
  formatTimeRange,
} from "../lib/dates";
import {
  deleteBookingPermanently,
  deleteSlotPermanently,
} from "../lib/hub-enhancements";
import { rpc } from "../lib/operations";
import {
  appointmentsOnDay,
  dateShift,
  positionAppointments,
  romeInputToIso,
  toRomeInput,
  weekStart,
} from "../lib/scheduling";

export interface CalendarItem {
  kind: "booking" | "free";
  bookingId: string | null;
  slotId: string;
  sessionId: string;
  candidateName: string | null;
  candidateEmail: string | null;
  areaId: string;
  areaName: string;
  roomName: string;
  startsAt: string;
  endsAt: string;
  status: "confirmed" | "cancelled" | "available";
  campaignId: string;
  sessionName: string;
}

interface Destination {
  id: string;
  startsAt: string;
  endsAt: string;
  roomName: string;
  areaName: string;
}

const today = () => toRomeInput(new Date().toISOString()).slice(0, 10);
const itemKey = (item: CalendarItem) =>
  item.kind === "booking" ? `booking-${item.bookingId}` : `free-${item.slotId}`;

export function CalendarPage() {
  const { access } = useAuth();
  const [mode, setMode] = useState<"list" | "week">("list");
  const [date, setDate] = useState(today);
  const [area, setArea] = useState("");
  const [selected, setSelected] = useState<CalendarItem | null>(null);
  const first = weekStart(date);
  const last = dateShift(first, 7);

  const areas = useQuery({
    queryKey: ["areas"],
    queryFn: listAreas,
    enabled: access?.isAdmin,
  });
  const query = useQuery({
    queryKey: ["calendar", access?.userId, first, area],
    queryFn: () =>
      rpc<CalendarItem[]>("list_calendar_bookings", {
        p_start: romeInputToIso(first + "T00:00"),
        p_end: romeInputToIso(last + "T00:00"),
        p_area_id: area || null,
      }),
  });

  const items = query.data ?? [];
  const days = Array.from({ length: 7 }, (_, i) => dateShift(first, i));
  const bookedCount = items.filter(
    (item) => item.kind === "booking" && item.status === "confirmed",
  ).length;
  const cancelledCount = items.filter(
    (item) => item.kind === "booking" && item.status === "cancelled",
  ).length;
  const freeCount = items.filter((item) => item.kind === "free").length;

  return (
    <div className="page-container">
      <PageHeader
        eyebrow={access?.isAdmin ? "Calendario generale" : "Calendario area"}
        title="Calendario colloqui e slot"
        description="Vedi nello stesso calendario appuntamenti prenotati, prenotazioni annullate conservate nello storico e slot ancora liberi. Puoi spostare, modificare, annullare o eliminare definitivamente secondo i tuoi permessi. Orari Europe/Rome."
      />

      <section className="panel calendar-legend" aria-label="Legenda calendario">
        <span className="calendar-legend__item calendar-legend__item--booked">
          <i /> Prenotati <strong>{bookedCount}</strong>
        </span>
        <span className="calendar-legend__item calendar-legend__item--free">
          <i /> Liberi <strong>{freeCount}</strong>
        </span>
        <span className="calendar-legend__item calendar-legend__item--cancelled">
          <i /> Annullati nello storico <strong>{cancelledCount}</strong>
        </span>
      </section>

      <section className="panel filter-bar">
        <div className="table-actions" aria-label="Visualizzazione">
          <button
            className={"button " + (mode === "list" ? "button--primary" : "button--secondary")}
            aria-pressed={mode === "list"}
            onClick={() => setMode("list")}
          >
            Lista
          </button>
          <button
            className={"button " + (mode === "week" ? "button--primary" : "button--secondary")}
            aria-pressed={mode === "week"}
            onClick={() => setMode("week")}
          >
            Calendario
          </button>
        </div>
        <button className="button button--secondary" aria-label="Settimana precedente" onClick={() => setDate(dateShift(first, -7))}>←</button>
        <button className="button button--secondary" onClick={() => setDate(today())}>Oggi</button>
        <button className="button button--secondary" aria-label="Settimana successiva" onClick={() => setDate(dateShift(first, 7))}>→</button>
        <label>
          Settimana del
          <input
            className="input"
            type="date"
            value={date}
            onChange={(e) => {
              if (e.target.value) setDate(e.target.value);
            }}
          />
        </label>
        {access?.isAdmin && (
          <label>
            Area
            <select className="select" value={area} onChange={(e) => setArea(e.target.value)}>
              <option value="">Tutte le aree</option>
              {areas.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}
      </section>

      {query.error && <p className="form-error" role="alert">{query.error.message}</p>}
      {query.isLoading && <p>Caricamento calendario…</p>}
      {!query.isLoading && !items.length && (
        <section className="panel panel__body">
          Nessun appuntamento o slot libero in questa settimana. Puoi cambiare data o filtro area.
        </section>
      )}

      {mode === "week" ? (
        <WeekCalendar days={days} items={items} onSelect={setSelected} />
      ) : (
        <div className="calendar-days">
          {days.map((day) => {
            const appointments = appointmentsOnDay(items, day).map((segment) => segment.original);
            return appointments.length ? (
              <section className="panel calendar-day" key={day}>
                <div className="panel__header">
                  <h2>{formatBookingDay(romeInputToIso(day + "T12:00"))}</h2>
                </div>
                {appointments.map((item) => (
                  <button
                    className={`appointment-row appointment-button calendar-item calendar-item--${item.kind === "free" ? "free" : item.status}`}
                    key={itemKey(item)}
                    onClick={() => setSelected(item)}
                  >
                    <time>{formatTimeRange(item.startsAt, item.endsAt)}</time>
                    <div>
                      <strong>
                        {item.kind === "free"
                          ? "Slot libero"
                          : item.candidateName || "Prenotazione"}
                      </strong>
                      <small>
                        {item.kind === "free"
                          ? item.sessionName
                          : item.candidateEmail || ""}
                      </small>
                    </div>
                    <div>
                      <strong>{item.areaName} · {item.roomName}</strong>
                      <small>
                        {item.kind === "free"
                          ? "Disponibile e prenotabile"
                          : item.status === "confirmed"
                            ? "Prenotato"
                            : "Annullato · storico conservato"}
                      </small>
                    </div>
                    <span>Gestisci →</span>
                  </button>
                ))}
              </section>
            ) : null;
          })}
        </div>
      )}

      {selected?.kind === "booking" && (
        <BookingManager item={selected} onClose={() => setSelected(null)} />
      )}
      {selected?.kind === "free" && (
        <FreeSlotManager item={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function WeekCalendar({
  days,
  items,
  onSelect,
}: {
  days: string[];
  items: CalendarItem[];
  onSelect: (item: CalendarItem) => void;
}) {
  const segments = days.map((day) => appointmentsOnDay(items, day));
  const startHour = Math.min(8, ...segments.flat().map((item) => Math.floor(item.startMinute / 60)));
  const endHour = Math.max(19, ...segments.flat().map((item) => Math.ceil(item.endMinute / 60)));
  const hourHeight = 100;

  return (
    <div className="week-scroll">
      <div className="week-grid">
        <div className="week-heading">Ora</div>
        {days.map((day) => (
          <div className="week-heading" key={day}>{formatBookingDay(romeInputToIso(day + "T12:00"))}</div>
        ))}
        <div className="week-hours" style={{ height: (endHour - startHour) * hourHeight }}>
          {Array.from({ length: endHour - startHour }, (_, index) => (
            <time style={{ top: index * hourHeight }} key={index}>{String(startHour + index).padStart(2, "0")}:00</time>
          ))}
        </div>
        {days.map((day, dayIndex) => (
          <div className="week-column" key={day} style={{ height: (endHour - startHour) * hourHeight }}>
            {positionAppointments(segments[dayIndex]).map((positioned) => {
              const item = positioned.item.original;
              const visualState = item.kind === "free" ? "free" : item.status;
              return (
                <button
                  key={itemKey(item)}
                  className={`week-appointment week-appointment--${visualState}`}
                  onClick={() => onSelect(item)}
                  style={{
                    top: ((positioned.item.startMinute - startHour * 60) * hourHeight) / 60,
                    height: (((positioned.end - positioned.start) / 60000) * hourHeight) / 60,
                    width: `calc(${100 / positioned.lanes}% - 4px)`,
                    left: `calc(${(100 * positioned.lane) / positioned.lanes}% + 2px)`,
                  }}
                  title={`${item.kind === "free" ? "Slot libero" : item.candidateName} · ${item.areaName} · ${item.roomName} · ${formatDateTime(item.startsAt)} – ${formatDateTime(item.endsAt)}`}
                >
                  <strong>{item.areaName} · {item.kind === "free" ? "LIBERO" : item.candidateName}</strong>
                  <span>{formatTimeRange(positioned.item.startsAt, positioned.item.endsAt)} · {item.roomName}</span>
                  <small>{item.kind === "free" ? item.sessionName : item.candidateEmail}</small>
                  <small>
                    {item.kind === "free"
                      ? "Disponibile"
                      : item.status === "confirmed"
                        ? "Prenotato"
                        : "Annullato"}
                  </small>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function BookingManager({ item, onClose }: { item: CalendarItem; onClose: () => void }) {
  const cache = useQueryClient();
  const [destination, setDestination] = useState("");
  const [lifecycleOpen, setLifecycleOpen] = useState(false);
  const bookingId = item.bookingId ?? "";

  const slots = useQuery({
    queryKey: ["booking-destinations", bookingId],
    queryFn: () => rpc<Destination[]>("list_booking_destinations", { p_booking_id: bookingId }),
    enabled: Boolean(bookingId && item.status === "confirmed"),
  });

  const mutation = useMutation({
    mutationFn: (action: "move" | "cancel" | "delete") => {
      if (action === "delete") return deleteBookingPermanently(bookingId);
      return rpc(action === "move" ? "move_booking" : "cancel_booking", {
        p_booking_id: bookingId,
        ...(action === "move" ? { p_new_slot_id: destination } : {}),
      });
    },
    onSuccess: async () => {
      await cache.invalidateQueries();
      onClose();
    },
  });

  return (
    <Modal title={item.candidateName || "Prenotazione"} onClose={() => { if (!mutation.isPending) onClose(); }}>
      <dl className="confirmation-details">
        <div><dt>Email</dt><dd>{item.candidateEmail || "—"}</dd></div>
        <div><dt>Appuntamento</dt><dd>{formatDateTime(item.startsAt)} · {formatTimeRange(item.startsAt, item.endsAt)}</dd></div>
        <div><dt>Area / aula</dt><dd>{item.areaName} · {item.roomName}</dd></div>
        <div><dt>Sessione</dt><dd>{item.sessionName}</dd></div>
        <div><dt>Stato</dt><dd>{item.status === "confirmed" ? "Prenotato" : "Annullato · storico conservato"}</dd></div>
      </dl>

      {item.status === "confirmed" && (
        <>
          <label className="form-field">
            Sposta in uno slot libero
            <select className="select" value={destination} onChange={(e) => setDestination(e.target.value)}>
              <option value="">Seleziona un nuovo appuntamento</option>
              {slots.data?.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {formatDateTime(slot.startsAt)} · {formatTimeRange(slot.startsAt, slot.endsAt)} · {slot.areaName} · {slot.roomName}
                </option>
              ))}
            </select>
          </label>
          {slots.isLoading ? <p>Ricerca slot liberi…</p> : !slots.data?.length && <p>Nessuno slot libero compatibile nella stessa campagna.</p>}
          <p className="field-help">Lo spostamento e l'annullamento con conservazione dello storico preparano automaticamente la notifica email prevista dal gestionale.</p>
          <div className="form-actions">
            <button className="button button--secondary" disabled={!destination || mutation.isPending} onClick={() => mutation.mutate("move")}>
              Conferma spostamento
            </button>
            <button className="button button--danger" disabled={mutation.isPending} onClick={() => setLifecycleOpen(true)}>
              Annulla prenotazione…
            </button>
          </div>
        </>
      )}

      {item.status === "cancelled" && (
        <div className="form-actions">
          <button
            className="button button--danger"
            disabled={mutation.isPending}
            onClick={() => {
              if (window.confirm("Eliminare definitivamente questa prenotazione annullata? Lo storico della prenotazione non sarà recuperabile.")) {
                mutation.mutate("delete");
              }
            }}
          >
            Elimina definitivamente dallo storico
          </button>
        </div>
      )}

      {(mutation.error || slots.error) && <p className="form-error" role="alert">{(mutation.error || slots.error)?.message}</p>}

      {lifecycleOpen && (
        <CancelDeleteDialog
          title="Come vuoi annullare la prenotazione?"
          description="Entrambe le scelte liberano immediatamente lo slot, che torna prenotabile. Scegli se conservare lo storico oppure rimuoverlo definitivamente."
          itemLabel="La prenotazione"
          pending={mutation.isPending}
          error={mutation.error?.message}
          onClose={() => setLifecycleOpen(false)}
          onCancelOnly={() => mutation.mutate("cancel")}
          onCancelAndDelete={() => mutation.mutate("delete")}
        />
      )}
    </Modal>
  );
}

function FreeSlotManager({ item, onClose }: { item: CalendarItem; onClose: () => void }) {
  const cache = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(toRomeInput(item.startsAt));
  const [end, setEnd] = useState(toRomeInput(item.endsAt));
  const [lifecycleOpen, setLifecycleOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: (action: "edit" | "close" | "delete") => {
      if (action === "delete") return deleteSlotPermanently(item.slotId);
      return rpc("manage_slot", {
        p_slot_id: item.slotId,
        p_action: action,
        p_starts_at: action === "edit" ? romeInputToIso(start) : null,
        p_ends_at: action === "edit" ? romeInputToIso(end) : null,
      });
    },
    onSuccess: async () => {
      await cache.invalidateQueries();
      onClose();
    },
  });

  return (
    <Modal title="Slot libero" onClose={() => { if (!mutation.isPending) onClose(); }}>
      <dl className="confirmation-details">
        <div><dt>Quando</dt><dd>{formatDateTime(item.startsAt)} · {formatTimeRange(item.startsAt, item.endsAt)}</dd></div>
        <div><dt>Area / aula</dt><dd>{item.areaName} · {item.roomName}</dd></div>
        <div><dt>Sessione</dt><dd>{item.sessionName}</dd></div>
        <div><dt>Stato</dt><dd>Libero e prenotabile</dd></div>
      </dl>

      <div className="form-actions">
        <button className="button button--secondary" disabled={mutation.isPending} onClick={() => setEditing((value) => !value)}>
          Modifica orario
        </button>
        <button className="button button--danger" disabled={mutation.isPending} onClick={() => setLifecycleOpen(true)}>
          Annulla slot…
        </button>
      </div>

      {editing && (
        <form
          className="form-grid calendar-slot-edit"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate("edit");
          }}
        >
          <label className="form-field">
            Inizio
            <input className="input" type="datetime-local" required value={start} onChange={(event) => setStart(event.target.value)} />
          </label>
          <label className="form-field">
            Fine
            <input className="input" type="datetime-local" required min={start} value={end} onChange={(event) => setEnd(event.target.value)} />
          </label>
          <button className="button button--primary" disabled={mutation.isPending}>Salva nuovo orario</button>
        </form>
      )}

      {mutation.error && <p className="form-error" role="alert">{mutation.error.message}</p>}

      {lifecycleOpen && (
        <CancelDeleteDialog
          title="Come vuoi annullare lo slot?"
          description="Conservandolo, lo slot viene chiuso e resta nel database della sessione. Eliminandolo, viene rimosso definitivamente. In entrambi i casi non sarà più prenotabile."
          itemLabel="Lo slot"
          pending={mutation.isPending}
          error={mutation.error?.message}
          onClose={() => setLifecycleOpen(false)}
          onCancelOnly={() => mutation.mutate("close")}
          onCancelAndDelete={() => mutation.mutate("delete")}
        />
      )}
    </Modal>
  );
}
