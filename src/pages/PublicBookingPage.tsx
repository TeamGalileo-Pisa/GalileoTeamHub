import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  Clock3,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useParams } from "react-router-dom";
import { z } from "zod";
import { Brand } from "../components/Brand";
import { appConfig } from "../lib/config";
import { formatBookingDay, formatTimeRange, groupByDay } from "../lib/dates";
import {
  createPublicBooking,
  getPublicBookingAvailability,
} from "../lib/data";
import type { BookingConfirmation } from "../types/domain";

const schema = z.object({
  firstName: z.string().trim().min(2, "Inserisci il nome").max(80),
  lastName: z.string().trim().min(2, "Inserisci il cognome").max(80),
  email: z.string().trim().email("Inserisci un indirizzo email valido").max(254),
});

export function PublicBookingPage() {
  const { token = "" } = useParams();
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [confirmation, setConfirmation] =
    useState<BookingConfirmation | null>(null);
  const availabilityQuery = useQuery({
    queryKey: ["public-booking", token],
    queryFn: () => getPublicBookingAvailability(token),
    enabled: Boolean(token && appConfig.hasSupabaseConfiguration),
    retry: false,
  });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const bookingMutation = useMutation({
    mutationFn: (values: z.infer<typeof schema>) => {
      if (!selectedSlotId) throw new Error("Seleziona prima uno slot");
      return createPublicBooking({
        token,
        slotId: selectedSlotId,
        ...values,
      });
    },
    onSuccess: (result) => setConfirmation(result),
  });
  const slots = useMemo(
    () => availabilityQuery.data?.slots ?? [],
    [availabilityQuery.data?.slots],
  );
  const days = useMemo(() => groupByDay(slots), [slots]);
  const selectedSlot = slots.find((slot) => slot.id === selectedSlotId);

  if (confirmation) {
    return (
      <main className="public-page">
        <div className="public-page__topbar">
          <Brand />
        </div>
        <section className="confirmation-card">
          <span className="confirmation-card__icon">
            <CheckCircle2 size={34} />
          </span>
          <p className="eyebrow">Operazione completata</p>
          <h1>Prenotazione confermata</h1>
          <p>
            La conferma verrà inviata all’indirizzo email che hai indicato.
          </p>
          <dl className="confirmation-details">
            <div>
              <dt>Nome</dt>
              <dd>{confirmation.candidateName}</dd>
            </div>
            <div>
              <dt>Area</dt>
              <dd>{confirmation.areaName}</dd>
            </div>
            <div>
              <dt>Data</dt>
              <dd>{formatBookingDay(confirmation.startsAt)}</dd>
            </div>
            <div>
              <dt>Orario</dt>
              <dd>
                {formatTimeRange(confirmation.startsAt, confirmation.endsAt)}
              </dd>
            </div>
            <div>
              <dt>Aula</dt>
              <dd>{confirmation.roomName}</dd>
            </div>
          </dl>
        </section>
      </main>
    );
  }

  return (
    <main className="public-page">
      <div className="public-page__topbar">
        <Brand />
        <span className="private-link-badge">
          <ShieldCheck size={15} /> Link privato
        </span>
      </div>

      <section className="booking-hero">
        <p className="eyebrow">Recruitment Team Galileo</p>
        <h1>Prenota il tuo colloquio</h1>
        <p>
          Scegli un orario disponibile e inserisci i soli dati necessari per
          ricevere la conferma.
        </p>
      </section>

      {!appConfig.hasSupabaseConfiguration ? (
        <section className="public-error-card">
          Il servizio di prenotazione non è ancora configurato.
        </section>
      ) : availabilityQuery.isLoading ? (
        <section className="public-loading">Caricamento orari disponibili…</section>
      ) : availabilityQuery.error ? (
        <section className="public-error-card" role="alert">
          Questo link non è valido, è scaduto oppure è stato disattivato.
          Chiedi un nuovo invito al tuo Capo Area.
        </section>
      ) : (
        <div className="booking-layout">
          <section className="booking-card">
            <div className="booking-card__header">
              <span>
                <CalendarDays size={19} />
              </span>
              <div>
                <p>{availabilityQuery.data?.areaName}</p>
                <h2>{availabilityQuery.data?.sessionName}</h2>
              </div>
            </div>

            {days.length ? (
              <div className="booking-days">
                {days.map((day) => (
                  <div className="booking-day" key={day.date.toISOString()}>
                    <h3>{formatBookingDay(day.items[0].startsAt)}</h3>
                    <div className="slot-grid">
                      {day.items.map((slot) => (
                        <button
                          className={`slot-button ${selectedSlotId === slot.id ? "slot-button--selected" : ""}`}
                          type="button"
                          key={slot.id}
                          aria-pressed={selectedSlotId === slot.id}
                          onClick={() => setSelectedSlotId(slot.id)}
                        >
                          <Clock3 size={15} />
                          <strong>
                            {formatTimeRange(slot.startsAt, slot.endsAt)}
                          </strong>
                          <small>
                            <MapPin size={12} /> {slot.roomName}
                          </small>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="no-public-slots">
                <CalendarCheck size={25} />
                <h2>Nessun orario disponibile</h2>
                <p>Gli slot potrebbero essere già stati prenotati.</p>
              </div>
            )}
          </section>

          <aside className="booking-form-card">
            <div>
              <p className="eyebrow">I tuoi dati</p>
              <h2>Completa la prenotazione</h2>
            </div>

            {selectedSlot ? (
              <div className="selected-slot-summary">
                <CalendarCheck size={18} />
                <span>
                  <strong>{formatBookingDay(selectedSlot.startsAt)}</strong>
                  <small>
                    {formatTimeRange(selectedSlot.startsAt, selectedSlot.endsAt)} · {selectedSlot.roomName}
                  </small>
                </span>
              </div>
            ) : (
              <div className="selected-slot-placeholder">
                Seleziona prima uno degli orari disponibili.
              </div>
            )}

            <form
              className="public-booking-form"
              onSubmit={form.handleSubmit((values) =>
                bookingMutation.mutate(values),
              )}
            >
              <div className="form-field">
                <label htmlFor="candidate-first-name">Nome</label>
                <input
                  id="candidate-first-name"
                  className="input"
                  autoComplete="given-name"
                  {...form.register("firstName")}
                />
                {form.formState.errors.firstName && (
                  <span className="field-error">
                    {form.formState.errors.firstName.message}
                  </span>
                )}
              </div>
              <div className="form-field">
                <label htmlFor="candidate-last-name">Cognome</label>
                <input
                  id="candidate-last-name"
                  className="input"
                  autoComplete="family-name"
                  {...form.register("lastName")}
                />
              </div>
              <div className="form-field">
                <label htmlFor="candidate-email">Email</label>
                <input
                  id="candidate-email"
                  className="input"
                  type="email"
                  autoComplete="email"
                  {...form.register("email")}
                />
                {form.formState.errors.email && (
                  <span className="field-error">
                    {form.formState.errors.email.message}
                  </span>
                )}
              </div>
              {bookingMutation.error && (
                <div className="form-error" role="alert">
                  {bookingMutation.error.message.includes("SLOT_UNAVAILABLE")
                    ? "Questo slot è appena stato prenotato. Scegline un altro."
                    : "Non è stato possibile completare la prenotazione. Riprova."}
                </div>
              )}
              <button
                className="button button--primary public-submit"
                type="submit"
                disabled={!selectedSlotId || bookingMutation.isPending}
              >
                {bookingMutation.isPending
                  ? "Conferma in corso…"
                  : "Conferma prenotazione"}
              </button>
            </form>

            <p className="privacy-note">
              Raccogliamo soltanto nome, cognome, email e dati
              dell’appuntamento.
            </p>
          </aside>
        </div>
      )}
    </main>
  );
}
