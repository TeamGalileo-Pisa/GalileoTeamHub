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
import { useForm, useWatch } from "react-hook-form";
import { useParams } from "react-router-dom";
import { z } from "zod";
import { Brand } from "../components/Brand";
import { appConfig } from "../lib/config";
import { formatBookingDay, formatTimeRange, groupByDay } from "../lib/dates";
import { createPublicBooking, getPublicBookingAvailability } from "../lib/data";
import type { BookingConfirmation } from "../types/domain";
import { bookingSchema as schema } from "../lib/booking-validation";

export function PublicBookingPage() {
  const { token = "" } = useParams();
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(
    null,
  );
  const availabilityQuery = useQuery({
    queryKey: ["public-booking", token],
    queryFn: () => getPublicBookingAvailability(token),
    enabled: Boolean(token && appConfig.hasSupabaseConfiguration),
    retry: false,
  });
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { slotId: "", firstName: "", lastName: "", email: "" },
  });
  const selectedSlotId = useWatch({ control: form.control, name: "slotId" });
  const bookingMutation = useMutation({
    mutationFn: (values: z.infer<typeof schema>) => {
      if (!selectedSlotId) throw new Error("Seleziona prima uno slot");
      return createPublicBooking({
        token,
        ...values,
      });
    },
    onSuccess: (result) => setConfirmation(result),
  });
  const slots = useMemo(
    () => availabilityQuery.data?.slots ?? [],
    [availabilityQuery.data?.slots],
  );
  const sortedSlots = useMemo(
    () =>
      [...slots].sort(
        (a, b) =>
          new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
      ),
    [slots],
  );
  const days = useMemo(() => groupByDay(sortedSlots), [sortedSlots]);
  const selectedSlot = sortedSlots.find((slot) => slot.id === selectedSlotId);

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
          <h1>Grazie per la tua prenotazione!</h1>
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
          <p>
            La conferma che questa prenotazione è valida ti arriverà
            automaticamente all’indirizzo email che hai indicato entro massimo 5
            minuti.
          </p>
          <p>
            Ricordati di controllare anche la cartella Spam nel caso non la
            vedessi arrivare.
          </p>
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
        <section className="public-loading">
          Caricamento orari disponibili…
        </section>
      ) : availabilityQuery.error ? (
        <section className="public-error-card" role="alert">
          Questo link non è valido, è scaduto oppure è stato disattivato. Chiedi
          un nuovo invito al tuo Capo Area.
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
                <small className="booking-card__availability-summary">
                  {days.length} {days.length === 1 ? "giorno" : "giorni"} ·{" "}
                  {slots.length} {slots.length === 1 ? "slot libero" : "slot liberi"} · tutte le aule
                </small>
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
                          onClick={() =>
                            form.setValue("slotId", slot.id, {
                              shouldValidate: true,
                            })
                          }
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
                    {formatTimeRange(
                      selectedSlot.startsAt,
                      selectedSlot.endsAt,
                    )}{" "}
                    · {selectedSlot.roomName}
                  </small>
                </span>
              </div>
            ) : (
              <div className="selected-slot-placeholder">
                Seleziona prima uno degli orari disponibili.
              </div>
            )}

            <form
              noValidate
              className="public-booking-form"
              onSubmit={form.handleSubmit((values) =>
                bookingMutation.mutate(values),
              )}
            >
              <input type="hidden" {...form.register("slotId")} />
              {form.formState.errors.slotId && (
                <span className="field-error" role="alert">
                  {form.formState.errors.slotId.message}
                </span>
              )}
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
                {form.formState.errors.lastName && (
                  <span className="field-error">
                    {form.formState.errors.lastName.message}
                  </span>
                )}
              </div>
              <div className="form-field">
                <label htmlFor="candidate-email">Email universitaria</label>
                <input
                  id="candidate-email"
                  className="input"
                  type="email"
                  autoComplete="email"
                  placeholder="nome.cognome@studenti.unipi.it"
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
                  {bookingMutation.error.message}
                </div>
              )}
              <button
                className="button button--primary public-submit"
                type="submit"
                disabled={bookingMutation.isPending || !slots.length}
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
