import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarCheck, CalendarDays, Clock3, MapPin, XCircle } from "lucide-react";
import { useParams } from "react-router-dom";
import { useState } from "react";
import { Brand } from "../components/Brand";
import { appConfig } from "../lib/config";
import { changeManagedBooking, cancelManagedBooking, getManagedBooking } from "../lib/data";
import { formatBookingDay, formatTimeRange } from "../lib/dates";

export function ManageBookingPage() {
  const { token = "" } = useParams();
  const [cancelled, setCancelled] = useState(false);
  const query = useQuery({
    queryKey: ["managed-booking", token],
    queryFn: () => getManagedBooking(token),
    enabled: Boolean(token && appConfig.hasSupabaseConfiguration),
    retry: false,
  });
  const change = useMutation({
    mutationFn: (slotId: string) => changeManagedBooking(token, slotId),
    onSuccess: () => query.refetch(),
  });
  const cancel = useMutation({
    mutationFn: () => cancelManagedBooking(token),
    onSuccess: () => setCancelled(true),
  });

  return (
    <main className="public-page">
      <div className="public-page__topbar"><Brand /></div>
      <section className="booking-hero">
        <p className="eyebrow">Gestione prenotazione</p>
        <h1>Modifica o annulla il tuo colloquio</h1>
        <p>Puoi cambiare orario scegliendo uno slot libero oppure annullare la prenotazione.</p>
      </section>

      {cancelled ? (
        <section className="confirmation-card">
          <span className="confirmation-card__icon"><XCircle size={34} /></span>
          <h1>Prenotazione annullata</h1>
          <p>La prenotazione è stata annullata. Il Capo Area riceverà una notifica di sistema.</p>
        </section>
      ) : query.isLoading ? (
        <section className="public-loading">Caricamento prenotazione…</section>
      ) : query.error ? (
        <section className="public-error-card">Il link non è valido, è scaduto oppure la prenotazione è già stata annullata.</section>
      ) : query.data ? (
        <div className="booking-layout">
          <section className="booking-card">
            <div className="booking-card__header">
              <span><CalendarCheck size={19} /></span>
              <div>
                <p>{query.data.booking.areaName}</p>
                <h2>{query.data.booking.candidateName}</h2>
              </div>
            </div>
            <div className="selected-slot-summary">
              <CalendarDays size={18} />
              <span>
                <strong>{formatBookingDay(query.data.booking.startsAt)}</strong>
                <small>{formatTimeRange(query.data.booking.startsAt, query.data.booking.endsAt)} · {query.data.booking.roomName}</small>
              </span>
            </div>
            <h3>Orari alternativi</h3>
            <div className="slot-grid">
              {query.data.slots.map((slot) => (
                <button
                  className="slot-button"
                  type="button"
                  key={slot.id}
                  disabled={change.isPending}
                  onClick={() => change.mutate(slot.id)}
                >
                  <Clock3 size={15} />
                  <strong>{formatTimeRange(slot.startsAt, slot.endsAt)}</strong>
                  <small><MapPin size={12} /> {slot.roomName}</small>
                </button>
              ))}
            </div>
            {!query.data.slots.length && (
              <p className="field-help">Non ci sono altri slot disponibili almeno 24 ore prima del colloquio.</p>
            )}
            {change.error && <p className="form-error" role="alert">{change.error.message}</p>}
          </section>

          <aside className="booking-form-card">
            <p className="eyebrow">Attenzione</p>
            <h2>Vuoi annullare?</h2>
            <p>L'annullamento libera immediatamente lo slot e avvisa il Capo Area.</p>
            <button className="button button--danger" type="button" disabled={cancel.isPending} onClick={() => {
              if (window.confirm("Vuoi davvero annullare questa prenotazione?")) cancel.mutate();
            }}>
              {cancel.isPending ? "Annullamento…" : "Annulla prenotazione"}
            </button>
            {cancel.error && <p className="form-error" role="alert">{cancel.error.message}</p>}
          </aside>
        </div>
      ) : null}
    </main>
  );
}
