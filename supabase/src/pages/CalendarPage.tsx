import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { Modal, ConfirmDialog } from "../components/Modal";
import { useAuth } from "../hooks/useAuth";
import { listAreas } from "../lib/data";
import {
  formatBookingDay,
  formatDateTime,
  formatTimeRange,
} from "../lib/dates";
import {
  appointmentsOnDay,
  dateShift,
  positionAppointments,
  romeInputToIso,
  toRomeInput,
  weekStart,
} from "../lib/scheduling";
import { rpc } from "../lib/operations";

export interface CalendarBooking {
  bookingId: string;
  candidateName: string;
  candidateEmail: string;
  areaId: string;
  areaName: string;
  roomName: string;
  startsAt: string;
  endsAt: string;
  status: "confirmed" | "cancelled";
  campaignId: string;
}
interface Destination {
  id: string;
  startsAt: string;
  endsAt: string;
  roomName: string;
  areaName: string;
}
const today = () => toRomeInput(new Date().toISOString()).slice(0, 10);
export function CalendarPage() {
  const { access } = useAuth();
  const [mode, setMode] = useState<"list" | "week">("list");
  const [date, setDate] = useState(today);
  const [area, setArea] = useState("");
  const [selected, setSelected] = useState<CalendarBooking | null>(null);
  const first = weekStart(date),
    last = dateShift(first, 7);
  const areas = useQuery({
    queryKey: ["areas"],
    queryFn: listAreas,
    enabled: access?.isAdmin,
  });
  const query = useQuery({
    queryKey: ["calendar", access?.userId, first, area],
    queryFn: () =>
      rpc<CalendarBooking[]>("list_calendar_bookings", {
        p_start: romeInputToIso(first + "T00:00"),
        p_end: romeInputToIso(last + "T00:00"),
        p_area_id: area || null,
      }),
  });
  const items = query.data ?? [];
  const days = Array.from({ length: 7 }, (_, i) => dateShift(first, i));
  return (
    <div className="page-container">
      <PageHeader
        eyebrow={access?.isAdmin ? "Calendario generale" : "Calendario area"}
        title="Colloqui"
        description="Consulta gli appuntamenti, spostali in uno slot libero o annullali conservando lo storico. Orari Europe/Rome."
      />
      <section className="panel filter-bar">
        <div className="table-actions" aria-label="Visualizzazione">
          <button
            className={
              "button " +
              (mode === "list" ? "button--primary" : "button--secondary")
            }
            aria-pressed={mode === "list"}
            onClick={() => setMode("list")}
          >
            Lista
          </button>
          <button
            className={
              "button " +
              (mode === "week" ? "button--primary" : "button--secondary")
            }
            aria-pressed={mode === "week"}
            onClick={() => setMode("week")}
          >
            Calendario
          </button>
        </div>
        <button
          className="button button--secondary"
          aria-label="Settimana precedente"
          onClick={() => setDate(dateShift(first, -7))}
        >
          ←
        </button>
        <button
          className="button button--secondary"
          onClick={() => setDate(today())}
        >
          Oggi
        </button>
        <button
          className="button button--secondary"
          aria-label="Settimana successiva"
          onClick={() => setDate(dateShift(first, 7))}
        >
          →
        </button>
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
            <select
              className="select"
              value={area}
              onChange={(e) => setArea(e.target.value)}
            >
              <option value="">Tutte le aree</option>
              {areas.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>
      {query.error && (
        <p className="form-error" role="alert">
          {query.error.message}
        </p>
      )}
      {query.isLoading && <p>Caricamento calendario…</p>}
      {!query.isLoading && !items.length && (
        <section className="panel panel__body">
          Nessun appuntamento in questa settimana. Puoi cambiare data o filtro
          area.
        </section>
      )}
      {mode === "week" ? (
        <WeekCalendar days={days} items={items} onSelect={setSelected} />
      ) : (
        <div className="calendar-days">
          {days.map((day) => {
            const appointments = appointmentsOnDay(items, day).map(
              (segment) => segment.original,
            );
            return appointments.length ? (
              <section className="panel calendar-day" key={day}>
                <div className="panel__header">
                  <h2>{formatBookingDay(romeInputToIso(day + "T12:00"))}</h2>
                </div>
                {appointments.map((b) => (
                  <button
                    className="appointment-row appointment-button"
                    key={b.bookingId}
                    onClick={() => setSelected(b)}
                  >
                    <time>{formatTimeRange(b.startsAt, b.endsAt)}</time>
                    <div>
                      <strong>{b.candidateName}</strong>
                      <small>{b.candidateEmail}</small>
                    </div>
                    <div>
                      <strong>
                        {b.areaName} · {b.roomName}
                      </strong>
                      <small>
                        {b.status === "confirmed" ? "Confermato" : "Annullato"}
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
      {selected && (
        <BookingManager booking={selected} onClose={() => setSelected(null)} />
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
  items: CalendarBooking[];
  onSelect: (b: CalendarBooking) => void;
}) {
  const segments = days.map((day) => appointmentsOnDay(items, day));
  const startHour = Math.min(
    8,
    ...segments.flat().map((b) => Math.floor(b.startMinute / 60)),
  );
  const endHour = Math.max(
    19,
    ...segments.flat().map((b) => Math.ceil(b.endMinute / 60)),
  );
  const hourHeight = 100;
  return (
    <div className="week-scroll">
      <div className="week-grid">
        <div className="week-heading">Ora</div>
        {days.map((d) => (
          <div className="week-heading" key={d}>
            {formatBookingDay(romeInputToIso(d + "T12:00"))}
          </div>
        ))}
        <div
          className="week-hours"
          style={{ height: (endHour - startHour) * hourHeight }}
        >
          {Array.from({ length: endHour - startHour }, (_, i) => (
            <time style={{ top: i * hourHeight }} key={i}>
              {String(startHour + i).padStart(2, "0")}:00
            </time>
          ))}
        </div>
        {days.map((day, dayIndex) => (
          <div
            className="week-column"
            key={day}
            style={{ height: (endHour - startHour) * hourHeight }}
          >
            {positionAppointments(segments[dayIndex]).map((p) => {
              const booking = p.item.original;
              return (
                <button
                  key={booking.bookingId}
                  className={
                    "week-appointment " +
                    (booking.status === "cancelled"
                      ? "week-appointment--cancelled"
                      : "")
                  }
                  onClick={() => onSelect(booking)}
                  style={{
                    top:
                      ((p.item.startMinute - startHour * 60) * hourHeight) / 60,
                    height: (((p.end - p.start) / 60000) * hourHeight) / 60,
                    width: `calc(${100 / p.lanes}% - 4px)`,
                    left: `calc(${(100 * p.lane) / p.lanes}% + 2px)`,
                  }}
                  title={`${booking.candidateName} · ${booking.candidateEmail} · ${booking.areaName} · ${booking.roomName} · ${formatDateTime(booking.startsAt)} – ${formatDateTime(booking.endsAt)}`}
                >
                  <strong>
                    {booking.areaName} · {booking.candidateName}
                  </strong>
                  <span>
                    {formatTimeRange(p.item.startsAt, p.item.endsAt)} ·{" "}
                    {booking.roomName}
                  </span>
                  <small>{booking.candidateEmail}</small>
                  <small>
                    {booking.status === "confirmed"
                      ? "Confermato"
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
function BookingManager({
  booking,
  onClose,
}: {
  booking: CalendarBooking;
  onClose: () => void;
}) {
  const cache = useQueryClient();
  const [destination, setDestination] = useState("");
  const [cancel, setCancel] = useState(false);
  const slots = useQuery({
    queryKey: ["booking-destinations", booking.bookingId],
    queryFn: () =>
      rpc<Destination[]>("list_booking_destinations", {
        p_booking_id: booking.bookingId,
      }),
    enabled: booking.status === "confirmed",
  });
  const mutation = useMutation({
    mutationFn: (action: "move" | "cancel") =>
      rpc(action === "move" ? "move_booking" : "cancel_booking", {
        p_booking_id: booking.bookingId,
        ...(action === "move" ? { p_new_slot_id: destination } : {}),
      }),
    onSuccess: async () => {
      await cache.invalidateQueries();
      onClose();
    },
  });
  return (
    <Modal
      title={booking.candidateName}
      onClose={() => {
        if (!mutation.isPending) onClose();
      }}
    >
      <dl className="confirmation-details">
        <div>
          <dt>Email</dt>
          <dd>{booking.candidateEmail}</dd>
        </div>
        <div>
          <dt>Appuntamento</dt>
          <dd>
            {formatDateTime(booking.startsAt)} ·{" "}
            {formatTimeRange(booking.startsAt, booking.endsAt)}
          </dd>
        </div>
        <div>
          <dt>Area / aula</dt>
          <dd>
            {booking.areaName} · {booking.roomName}
          </dd>
        </div>
        <div>
          <dt>Stato</dt>
          <dd>{booking.status === "confirmed" ? "Confermato" : "Annullato"}</dd>
        </div>
      </dl>
      {booking.status === "confirmed" && (
        <>
          <label className="form-field">
            Sposta in uno slot libero
            <select
              className="select"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            >
              <option value="">Seleziona un nuovo appuntamento</option>
              {slots.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {formatDateTime(s.startsAt)} ·{" "}
                  {formatTimeRange(s.startsAt, s.endsAt)} · {s.areaName} ·{" "}
                  {s.roomName}
                </option>
              ))}
            </select>
          </label>
          {slots.isLoading ? (
            <p>Ricerca slot liberi…</p>
          ) : (
            !slots.data?.length && (
              <p>Nessuno slot libero compatibile nella stessa campagna.</p>
            )
          )}
          <p className="field-help">
            Spostamento e annullamento preparano automaticamente una notifica
            email al candidato.
          </p>
          <div className="form-actions">
            <button
              className="button button--secondary"
              disabled={!destination || mutation.isPending}
              onClick={() => mutation.mutate("move")}
            >
              Conferma spostamento
            </button>
            <button
              className="button button--danger"
              disabled={mutation.isPending}
              onClick={() => setCancel(true)}
            >
              Annulla prenotazione
            </button>
          </div>
        </>
      )}
      {(mutation.error || slots.error) && (
        <p className="form-error" role="alert">
          {(mutation.error || slots.error)?.message}
        </p>
      )}
      {cancel && (
        <ConfirmDialog
          title="Annullare la prenotazione?"
          description="Lo slot verrà liberato. Il candidato riceverà una notifica e lo storico sarà conservato."
          pending={mutation.isPending}
          error={mutation.error?.message}
          onClose={() => setCancel(false)}
          onConfirm={() => mutation.mutate("cancel")}
        />
      )}
    </Modal>
  );
}
