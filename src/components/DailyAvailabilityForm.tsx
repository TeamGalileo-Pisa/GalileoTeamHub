import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  dailyAvailabilitySchema,
  dailyDates,
  type DailyAvailabilityInput,
} from "../lib/scheduling";
import { rpc } from "../lib/operations";
import { formatDateOnly } from "../lib/dates";
import type { Room } from "../types/domain";

export function DailyAvailabilityForm({
  rooms,
  onSuccess,
}: {
  rooms: Room[];
  onSuccess: (message: string) => void;
}) {
  const cache = useQueryClient();
  const form = useForm<DailyAvailabilityInput>({
    resolver: zodResolver(dailyAvailabilitySchema),
    defaultValues: {
      roomId: "",
      startDate: "",
      endDate: "",
      startTime: "08:30",
      endTime: "18:00",
      weekdays: [1, 2, 3, 4, 5],
      capacity: 1,
      note: "",
    },
  });
  const values = useWatch({ control: form.control });
  const days = dailyDates(
    values.startDate ?? "",
    values.endDate ?? "",
    values.weekdays ?? [],
  );
  const room = rooms.find((r) => r.id === values.roomId);
  const mutation = useMutation({
    mutationFn: (v: DailyAvailabilityInput) =>
      rpc<{ count: number }>("create_daily_availabilities", {
        p_room_id: v.roomId,
        p_start_date: v.startDate,
        p_end_date: v.endDate,
        p_start_time: v.startTime,
        p_end_time: v.endTime,
        p_weekdays: v.weekdays,
        p_capacity: v.capacity,
        p_note: v.note,
      }),
    onSuccess: async (result) => {
      onSuccess(`Create ${result.count} disponibilità giornaliere.`);
      await cache.invalidateQueries({ queryKey: ["room-availabilities"] });
    },
  });
  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <h2>Apri disponibilità giornaliere</h2>
          <p>Un giorno oppure un periodo · orari Europe/Rome</p>
        </div>
      </div>
      <form
        noValidate
        className="panel__body form-grid"
        onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
      >
        <div className="form-field form-field--full">
          <label htmlFor="daily-room">Aula</label>
          <select
            id="daily-room"
            className="select"
            {...form.register("roomId")}
          >
            <option value="">Seleziona aula</option>
            {rooms
              .filter((r) => r.active)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · limite fisico{" "}
                  {r.maxSimultaneousInterviewsLimit ?? "non configurato"}
                </option>
              ))}
          </select>
        </div>
        {(
          [
            ["startDate", "Data iniziale", "date"],
            ["endDate", "Data finale", "date"],
            ["startTime", "Ora inizio", "time"],
            ["endTime", "Ora fine", "time"],
          ] as const
        ).map(([key, label, type]) => (
          <div className="form-field" key={key}>
            <label htmlFor={`daily-${key}`}>{label}</label>
            <input
              id={`daily-${key}`}
              className="input"
              type={type}
              {...form.register(key)}
            />
          </div>
        ))}
        <fieldset className="form-field form-field--full weekday-picker">
          <legend>Giorni della settimana</legend>
          {["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((day, i) => (
            <label key={day}>
              <input
                type="checkbox"
                checked={values.weekdays?.includes(i + 1) ?? false}
                onChange={(e) =>
                  form.setValue(
                    "weekdays",
                    e.target.checked
                      ? [...(values.weekdays ?? []), i + 1]
                      : (values.weekdays ?? []).filter((d) => d !== i + 1),
                    { shouldValidate: true },
                  )
                }
              />
              {day}
            </label>
          ))}
        </fieldset>
        <div className="form-field">
          <label htmlFor="daily-capacity">Massimo colloqui simultanei</label>
          <input
            id="daily-capacity"
            className="input"
            type="number"
            min={1}
            max={room?.maxSimultaneousInterviewsLimit ?? 100}
            {...form.register("capacity", { valueAsNumber: true })}
          />
        </div>
        <div className="form-field form-field--full">
          <label htmlFor="daily-note">Nota per le aree</label>
          <textarea
            id="daily-note"
            className="textarea"
            placeholder="es. Disponibilità di lavagna"
            {...form.register("note")}
          />
        </div>
        <div className="admin-note form-field--full" aria-live="polite">
          <strong>Verranno create {days.length} disponibilità</strong>
          <ul className="daily-preview">
            {days.map((d) => (
              <li key={d}>
                {formatDateOnly(d)} · {values.startTime}–{values.endTime}
              </li>
            ))}
          </ul>
        </div>
        {Object.entries(form.formState.errors).map(([key, error]) => (
          <span key={key} className="field-error form-field--full" role="alert">
            {error.message}
          </span>
        ))}
        {mutation.error && (
          <p className="form-error form-field--full" role="alert">
            {mutation.error.message}
          </p>
        )}
        <div className="form-actions">
          <button
            className="button button--primary"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Creazione…" : "Conferma disponibilità"}
          </button>
        </div>
      </form>
    </section>
  );
}
