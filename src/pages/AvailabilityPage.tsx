import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Pencil, Plus, Trash2, Warehouse } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { useAuth } from "../hooks/useAuth";
import { formatDateTime, formatTimeRange } from "../lib/dates";
import {
  cancelRoomAvailability,
  claimRoomAllocation,
  createRoom,
  createRoomAvailability,
  getRoomAvailabilityIntervalUsage,
  listMyCampaignAreas,
  listRoomAvailabilities,
  listRooms,
  updateRoomAvailability,
} from "../lib/data";
import type { RoomAvailability } from "../types/domain";

const roomSchema = z.object({
  name: z.string().trim().min(2, "Inserisci il nome dell'aula"),
  location: z.string().trim().optional(),
  physicalLimit: z.string().trim().refine(
    (value) =>
      value === "" ||
      (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 100),
    "Inserisci un numero tra 1 e 100 oppure lascia vuoto",
  ),
});

const availabilitySchema = z
  .object({
    roomId: z.string().uuid("Seleziona un'aula"),
    startsAt: z.string().min(1, "Inserisci data e ora iniziale"),
    endsAt: z.string().min(1, "Inserisci data e ora finale"),
    maxSimultaneousInterviews: z.number().int().min(1).max(100),
    areaNote: z.string().trim().max(2000, "La nota è troppo lunga"),
  })
  .refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
    message: "L'orario finale deve essere successivo a quello iniziale",
    path: ["endsAt"],
  });

const allocationSchema = z
  .object({
    availabilityId: z.string().uuid("Seleziona una disponibilità"),
    campaignAreaId: z.string().uuid("Seleziona area e campagna"),
    startsAt: z.string().min(1, "Inserisci l'inizio della fascia"),
    endsAt: z.string().min(1, "Inserisci la fine della fascia"),
  })
  .refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
    message: "L'orario finale deve essere successivo a quello iniziale",
    path: ["endsAt"],
  });

function toLocalInput(value: string): string {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function AvailabilityPage() {
  const { access } = useAuth();
  const isAdmin = Boolean(access?.isAdmin);
  const queryClient = useQueryClient();
  const [success, setSuccess] = useState<string | null>(null);
  const [editing, setEditing] = useState<RoomAvailability | null>(null);
  const roomsQuery = useQuery({ queryKey: ["rooms"], queryFn: listRooms });
  const availabilityQuery = useQuery({
    queryKey: ["room-availabilities", access?.userId],
    queryFn: listRoomAvailabilities,
  });
  const campaignAreasQuery = useQuery({
    queryKey: ["my-campaign-areas", access?.userId],
    queryFn: listMyCampaignAreas,
    enabled: !isAdmin,
  });

  const roomForm = useForm<z.infer<typeof roomSchema>>({
    resolver: zodResolver(roomSchema),
    defaultValues: { physicalLimit: "" },
  });
  const availabilityForm = useForm<z.infer<typeof availabilitySchema>>({
    resolver: zodResolver(availabilitySchema),
    defaultValues: { maxSimultaneousInterviews: 1, areaNote: "" },
  });
  const allocationForm = useForm<z.infer<typeof allocationSchema>>({
    resolver: zodResolver(allocationSchema),
  });
  const editForm = useForm<z.infer<typeof availabilitySchema>>({
    resolver: zodResolver(availabilitySchema),
    defaultValues: { maxSimultaneousInterviews: 1, areaNote: "" },
  });

  useEffect(() => {
    if (!editing) return;
    editForm.reset({
      roomId: editing.roomId,
      startsAt: toLocalInput(editing.startsAt),
      endsAt: toLocalInput(editing.endsAt),
      maxSimultaneousInterviews: editing.maxSimultaneousInterviews,
      areaNote: editing.areaNote,
    });
  }, [editForm, editing]);

  const roomMutation = useMutation({
    mutationFn: (values: z.infer<typeof roomSchema>) =>
      createRoom({
        name: values.name,
        location: values.location,
        maxSimultaneousInterviewsLimit: values.physicalLimit
          ? Number(values.physicalLimit)
          : null,
      }),
    onMutate: () => setSuccess(null),
    onSuccess: async () => {
      roomForm.reset({ physicalLimit: "" });
      setSuccess("Aula creata correttamente.");
      await queryClient.invalidateQueries({ queryKey: ["rooms"] });
    },
  });
  const availabilityMutation = useMutation({
    mutationFn: createRoomAvailability,
    onMutate: () => setSuccess(null),
    onSuccess: async () => {
      availabilityForm.reset({ maxSimultaneousInterviews: 1, areaNote: "" });
      setSuccess("Disponibilità aperta correttamente.");
      await queryClient.invalidateQueries({ queryKey: ["room-availabilities"] });
    },
  });
  const editMutation = useMutation({
    mutationFn: updateRoomAvailability,
    onMutate: () => setSuccess(null),
    onSuccess: async () => {
      setEditing(null);
      setSuccess("Disponibilità aggiornata correttamente.");
      await queryClient.invalidateQueries({ queryKey: ["room-availabilities"] });
    },
  });
  const cancelMutation = useMutation({
    mutationFn: cancelRoomAvailability,
    onMutate: () => setSuccess(null),
    onSuccess: async () => {
      setSuccess("Disponibilità annullata.");
      await queryClient.invalidateQueries({ queryKey: ["room-availabilities"] });
    },
  });
  const allocationMutation = useMutation({
    mutationFn: claimRoomAllocation,
    onMutate: () => setSuccess(null),
    onSuccess: async () => {
      allocationForm.reset();
      setSuccess("Fascia assegnata alla tua area.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["room-availabilities"] }),
        queryClient.invalidateQueries({ queryKey: ["my-allocations"] }),
      ]);
    },
  });

  const availabilities = availabilityQuery.data ?? [];
  const allocationValues = useWatch({ control: allocationForm.control });
  const availabilityRoomId = useWatch({
    control: availabilityForm.control,
    name: "roomId",
  });
  const intervalUsageQuery = useQuery({
    queryKey: [
      "availability-interval-usage",
      allocationValues.availabilityId,
      allocationValues.startsAt,
      allocationValues.endsAt,
    ],
    queryFn: () =>
      getRoomAvailabilityIntervalUsage({
        availabilityId: allocationValues.availabilityId ?? "",
        startsAt: allocationValues.startsAt ?? "",
        endsAt: allocationValues.endsAt ?? "",
      }),
    enabled:
      !isAdmin &&
      Boolean(
        allocationValues.availabilityId &&
          allocationValues.startsAt &&
          allocationValues.endsAt &&
          new Date(allocationValues.endsAt) > new Date(allocationValues.startsAt),
      ),
    retry: false,
  });

  const selectedRoom = roomsQuery.data?.find(
    (room) => room.id === availabilityRoomId,
  );
  const selectedAvailability = availabilities.find(
    (item) => item.id === allocationValues.availabilityId,
  );

  return (
    <div className="page-container">
      <PageHeader
        eyebrow={isAdmin ? "Amministrazione" : "Area"}
        title="Disponibilità aule"
        description={
          isAdmin
            ? "Definisci finestre, capacità simultanea e indicazioni operative per le aree."
            : "Riserva una sottofascia: il database impedisce automaticamente di superare la capacità dell’aula."
        }
      />

      {success && (
        <div className="form-success page-feedback" role="status">
          {success}
        </div>
      )}

      {isAdmin ? (
        <div className="form-panels">
          <section className="panel">
            <div className="panel__header">
              <div>
                <h2>Nuova aula</h2>
                <p>Configura l’eventuale limite fisico</p>
              </div>
              <Warehouse size={20} />
            </div>
            <form
              className="panel__body form-grid"
              onSubmit={roomForm.handleSubmit((values) => roomMutation.mutate(values))}
            >
              <div className="form-field">
                <label htmlFor="room-name">Nome aula</label>
                <input
                  id="room-name"
                  className="input"
                  placeholder="es. F2"
                  {...roomForm.register("name")}
                />
                {roomForm.formState.errors.name && (
                  <span className="field-error">{roomForm.formState.errors.name.message}</span>
                )}
              </div>
              <div className="form-field">
                <label htmlFor="room-location">Posizione</label>
                <input
                  id="room-location"
                  className="input"
                  placeholder="es. Polo E, piano terra"
                  {...roomForm.register("location")}
                />
              </div>
              <div className="form-field form-field--full">
                <label htmlFor="room-limit">Limite fisico simultaneo</label>
                <input
                  id="room-limit"
                  className="input"
                  inputMode="numeric"
                  placeholder="Vuoto = nessun limite fisico configurato"
                  {...roomForm.register("physicalLimit")}
                />
                <small className="field-help">
                  La capacità di ogni finestra non potrà superare questo valore.
                </small>
                {roomForm.formState.errors.physicalLimit && (
                  <span className="field-error">{roomForm.formState.errors.physicalLimit.message}</span>
                )}
              </div>
              {roomMutation.error && (
                <div className="form-error form-field--full" role="alert">
                  {roomMutation.error.message}
                </div>
              )}
              <div className="form-actions">
                <button className="button button--secondary" type="submit" disabled={roomMutation.isPending}>
                  <Plus size={17} /> {roomMutation.isPending ? "Creazione…" : "Aggiungi aula"}
                </button>
              </div>
            </form>
          </section>

          <section className="panel">
            <div className="panel__header">
              <div>
                <h2>Apri una disponibilità</h2>
                <p>Capacità e nota sono sempre esplicite</p>
              </div>
              <CalendarPlus size={20} />
            </div>
            <form
              className="panel__body form-grid"
              onSubmit={availabilityForm.handleSubmit((values) =>
                availabilityMutation.mutate(values),
              )}
            >
              <div className="form-field form-field--full">
                <label htmlFor="availability-room">Aula</label>
                <select
                  id="availability-room"
                  className="select"
                  defaultValue=""
                  {...availabilityForm.register("roomId")}
                >
                  <option value="" disabled>Seleziona un'aula</option>
                  {roomsQuery.data?.filter((room) => room.active).map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                      {room.maxSimultaneousInterviewsLimit
                        ? ` · limite ${room.maxSimultaneousInterviewsLimit}`
                        : " · limite non configurato"}
                    </option>
                  ))}
                </select>
                {selectedRoom?.maxSimultaneousInterviewsLimit && (
                  <small className="field-help">Limite fisico: {selectedRoom.maxSimultaneousInterviewsLimit}</small>
                )}
              </div>
              <div className="form-field">
                <label htmlFor="availability-start">Inizio</label>
                <input id="availability-start" className="input" type="datetime-local" {...availabilityForm.register("startsAt")} />
              </div>
              <div className="form-field">
                <label htmlFor="availability-end">Fine</label>
                <input id="availability-end" className="input" type="datetime-local" {...availabilityForm.register("endsAt")} />
                {availabilityForm.formState.errors.endsAt && <span className="field-error">{availabilityForm.formState.errors.endsAt.message}</span>}
              </div>
              <div className="form-field">
                <label htmlFor="availability-capacity">Massimo colloqui simultanei</label>
                <input
                  id="availability-capacity"
                  className="input"
                  type="number"
                  min="1"
                  max={selectedRoom?.maxSimultaneousInterviewsLimit ?? 100}
                  {...availabilityForm.register("maxSimultaneousInterviews", { valueAsNumber: true })}
                />
              </div>
              <div className="form-field form-field--full">
                <label htmlFor="availability-note">Nota per le aree</label>
                <textarea
                  id="availability-note"
                  className="textarea"
                  rows={3}
                  placeholder="es. Utilizzare i due tavoli laterali."
                  {...availabilityForm.register("areaNote")}
                />
              </div>
              {availabilityMutation.error && <div className="form-error form-field--full" role="alert">{availabilityMutation.error.message}</div>}
              <div className="form-actions">
                <button className="button button--primary" type="submit" disabled={availabilityMutation.isPending}>
                  <CalendarPlus size={17} /> {availabilityMutation.isPending ? "Apertura…" : "Apri disponibilità"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : (
        <section className="panel allocation-form-panel">
          <div className="panel__header">
            <div>
              <h2>Prendi una fascia</h2>
              <p>Gli intervalli consecutivi non si sovrappongono: 09:00–10:00 e 10:00–11:00 sono compatibili.</p>
            </div>
          </div>
          <form className="panel__body form-grid" onSubmit={allocationForm.handleSubmit((values) => allocationMutation.mutate(values))}>
            <div className="form-field">
              <label htmlFor="allocation-availability">Disponibilità</label>
              <select id="allocation-availability" className="select" defaultValue="" {...allocationForm.register("availabilityId")}>
                <option value="" disabled>Seleziona aula e giornata</option>
                {availabilities.filter((item) => item.status === "active").map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.roomName} · {formatDateTime(item.startsAt)} · {item.simultaneousUsage}/{item.maxSimultaneousInterviews}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="allocation-area">Area e campagna</label>
              <select id="allocation-area" className="select" defaultValue="" {...allocationForm.register("campaignAreaId")}>
                <option value="" disabled>Seleziona area e recruitment</option>
                {campaignAreasQuery.data?.map((item) => (
                  <option key={item.id} value={item.id}>{item.areaName} · {item.campaignName}</option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="allocation-start">Inizio fascia</label>
              <input id="allocation-start" className="input" type="datetime-local" {...allocationForm.register("startsAt")} />
            </div>
            <div className="form-field">
              <label htmlFor="allocation-end">Fine fascia</label>
              <input id="allocation-end" className="input" type="datetime-local" {...allocationForm.register("endsAt")} />
              {allocationForm.formState.errors.endsAt && <span className="field-error">{allocationForm.formState.errors.endsAt.message}</span>}
            </div>
            {selectedAvailability?.areaNote && (
              <div className="admin-note form-field--full">
                <strong>Nota Amministrazione</strong>
                <p>{selectedAvailability.areaNote}</p>
              </div>
            )}
            {intervalUsageQuery.data && (
              <div className={`capacity-preview form-field--full ${intervalUsageQuery.data.complete ? "capacity-preview--full" : ""}`}>
                <strong>Capacità nella fascia: {intervalUsageQuery.data.usage} / {intervalUsageQuery.data.capacity}</strong>
                <span>{intervalUsageQuery.data.complete ? "COMPLETA" : `${intervalUsageQuery.data.remaining} posti disponibili`}</span>
              </div>
            )}
            {allocationMutation.error && <div className="form-error form-field--full" role="alert">{allocationMutation.error.message}</div>}
            <div className="form-actions">
              <button className="button button--primary" type="submit" disabled={allocationMutation.isPending || intervalUsageQuery.data?.complete}>
                {allocationMutation.isPending ? "Conferma…" : "Conferma fascia"}
              </button>
            </div>
          </form>
        </section>
      )}

      {isAdmin && editing && (
        <section className="panel edit-availability-panel">
          <div className="panel__header">
            <div><h2>Modifica {editing.roomName}</h2><p>Orari e capacità rispettano le assegnazioni esistenti.</p></div>
          </div>
          <form className="panel__body form-grid" onSubmit={editForm.handleSubmit((values) => editMutation.mutate({ id: editing.id, ...values }))}>
            <input type="hidden" {...editForm.register("roomId")} />
            <div className="form-field"><label htmlFor="edit-start">Inizio</label><input id="edit-start" className="input" type="datetime-local" {...editForm.register("startsAt")} /></div>
            <div className="form-field"><label htmlFor="edit-end">Fine</label><input id="edit-end" className="input" type="datetime-local" {...editForm.register("endsAt")} /></div>
            <div className="form-field"><label htmlFor="edit-capacity">Massimo simultaneo</label><input id="edit-capacity" className="input" type="number" min="1" max={editing.roomPhysicalLimit ?? 100} {...editForm.register("maxSimultaneousInterviews", { valueAsNumber: true })} /></div>
            <div className="form-field form-field--full"><label htmlFor="edit-note">Nota per le aree</label><textarea id="edit-note" className="textarea" rows={3} {...editForm.register("areaNote")} /></div>
            {editMutation.error && <div className="form-error form-field--full" role="alert">{editMutation.error.message}</div>}
            <div className="form-actions">
              <button className="button button--secondary" type="button" onClick={() => setEditing(null)}>Chiudi</button>
              <button className="button button--primary" type="submit" disabled={editMutation.isPending}>{editMutation.isPending ? "Salvataggio…" : "Salva modifiche"}</button>
            </div>
          </form>
        </section>
      )}

      <section className="panel availability-list-panel">
        <div className="panel__header"><div><h2>Disponibilità</h2><p>{availabilities.length} finestre complessive</p></div></div>
        <div className="panel__body panel__body--flush">
          {availabilityQuery.isLoading ? (
            <div className="table-loading">Caricamento disponibilità…</div>
          ) : availabilities.length ? (
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead><tr><th>Aula</th><th>Quando</th><th>Capacità</th><th>Nota</th><th>Stato</th>{isAdmin && <th>Azioni</th>}</tr></thead>
                <tbody>
                  {availabilities.map((availability) => {
                    const complete = availability.simultaneousUsage >= availability.maxSimultaneousInterviews;
                    return (
                      <tr key={availability.id}>
                        <td><strong>{availability.roomName}</strong><span className="table-secondary">Limite fisico: {availability.roomPhysicalLimit ?? "non configurato"}</span></td>
                        <td>{formatDateTime(availability.startsAt)}<span className="table-secondary">{formatTimeRange(availability.startsAt, availability.endsAt)}</span></td>
                        <td><strong>{availability.simultaneousUsage} / {availability.maxSimultaneousInterviews}</strong><span className="table-secondary">colloqui simultanei</span></td>
                        <td>{availability.areaNote || <span className="table-secondary">Nessuna nota</span>}</td>
                        <td><StatusBadge label={availability.status === "cancelled" ? "Annullata" : complete ? "Completa" : "Aperta"} tone={availability.status === "cancelled" ? "neutral" : complete ? "warning" : "success"} />{availability.bookedInterviews > 0 && <span className="booking-count">{availability.bookedInterviews} prenotati</span>}</td>
                        {isAdmin && (
                          <td><div className="table-actions">
                            <button className="button button--secondary button--small" type="button" disabled={availability.status !== "active"} onClick={() => setEditing(availability)}><Pencil size={15} /> Modifica</button>
                            <button className="button button--danger button--small" type="button" disabled={availability.status !== "active" || cancelMutation.isPending} onClick={() => { if (window.confirm("Vuoi annullare questa disponibilità? L'operazione verrà bloccata se contiene colloqui prenotati.")) cancelMutation.mutate(availability.id); }}><Trash2 size={15} /> Annulla</button>
                          </div></td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={Warehouse} title="Nessuna disponibilità" description={isAdmin ? "Aggiungi un'aula e apri la prima finestra per iniziare." : "L’Amministrazione non ha ancora aperto fasce utilizzabili."} />
          )}
        </div>
      </section>
    </div>
  );
}
