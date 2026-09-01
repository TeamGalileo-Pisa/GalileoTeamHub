import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Plus, Trash2, Warehouse } from "lucide-react";
import { useForm } from "react-hook-form";
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
  listMyCampaignAreas,
  listRoomAvailabilities,
  listRooms,
} from "../lib/data";

const roomSchema = z.object({
  name: z.string().trim().min(2, "Inserisci il nome dell'aula"),
  location: z.string().trim().optional(),
});

const availabilitySchema = z
  .object({
    roomId: z.string().uuid("Seleziona un'aula"),
    startsAt: z.string().min(1, "Inserisci data e ora iniziale"),
    endsAt: z.string().min(1, "Inserisci data e ora finale"),
  })
  .refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
    message: "L'orario finale deve essere successivo a quello iniziale",
    path: ["endsAt"],
  });

const allocationSchema = z
  .object({
    availabilityId: z.string().uuid(),
    campaignAreaId: z.string().uuid("Seleziona area e campagna"),
    startsAt: z.string().min(1, "Inserisci l'inizio della fascia"),
    endsAt: z.string().min(1, "Inserisci la fine della fascia"),
  })
  .refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
    message: "L'orario finale deve essere successivo a quello iniziale",
    path: ["endsAt"],
  });

export function AvailabilityPage() {
  const { access } = useAuth();
  const isAdmin = Boolean(access?.isAdmin);
  const queryClient = useQueryClient();
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
  });
  const availabilityForm = useForm<z.infer<typeof availabilitySchema>>({
    resolver: zodResolver(availabilitySchema),
  });
  const allocationForm = useForm<z.infer<typeof allocationSchema>>({
    resolver: zodResolver(allocationSchema),
  });

  const roomMutation = useMutation({
    mutationFn: createRoom,
    onSuccess: async () => {
      roomForm.reset();
      await queryClient.invalidateQueries({ queryKey: ["rooms"] });
    },
  });
  const availabilityMutation = useMutation({
    mutationFn: createRoomAvailability,
    onSuccess: async () => {
      availabilityForm.reset();
      await queryClient.invalidateQueries({
        queryKey: ["room-availabilities"],
      });
    },
  });
  const cancelMutation = useMutation({
    mutationFn: cancelRoomAvailability,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["room-availabilities"],
      });
    },
  });
  const allocationMutation = useMutation({
    mutationFn: claimRoomAllocation,
    onSuccess: async () => {
      allocationForm.reset();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["room-availabilities"] }),
        queryClient.invalidateQueries({ queryKey: ["my-allocations"] }),
      ]);
    },
  });

  const availabilities = availabilityQuery.data ?? [];

  return (
    <div className="page-container">
      <PageHeader
        eyebrow={isAdmin ? "Amministrazione" : "Area"}
        title="Disponibilità aule"
        description={
          isAdmin
            ? "Apri le fasce generali delle aule. Le aree potranno prenderne soltanto una porzione compatibile."
            : "Visualizza le fasce aperte dall’Amministrazione e riserva le ore necessarie alla tua sessione."
        }
      />

      {isAdmin ? (
        <div className="form-panels">
          <section className="panel">
            <div className="panel__header">
              <div>
                <h2>Nuova aula</h2>
                <p>Le aule restano indipendenti dalle aree</p>
              </div>
              <Warehouse size={20} />
            </div>
            <form
              className="panel__body form-grid"
              onSubmit={roomForm.handleSubmit((values) =>
                roomMutation.mutate(values),
              )}
            >
              <div className="form-field">
                <label htmlFor="room-name">Nome aula</label>
                <input
                  id="room-name"
                  className="input"
                  placeholder="es. Aula B1"
                  {...roomForm.register("name")}
                />
                {roomForm.formState.errors.name && (
                  <span className="field-error">
                    {roomForm.formState.errors.name.message}
                  </span>
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
              {roomMutation.error && (
                <div className="form-error form-field--full" role="alert">
                  {roomMutation.error.message}
                </div>
              )}
              <div className="form-actions">
                <button
                  className="button button--secondary"
                  type="submit"
                  disabled={roomMutation.isPending}
                >
                  <Plus size={17} /> Aggiungi aula
                </button>
              </div>
            </form>
          </section>

          <section className="panel">
            <div className="panel__header">
              <div>
                <h2>Apri una disponibilità</h2>
                <p>Definisci data e intervallo complessivo</p>
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
                  <option value="" disabled>
                    Seleziona un'aula
                  </option>
                  {roomsQuery.data?.filter((room) => room.active).map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="availability-start">Inizio</label>
                <input
                  id="availability-start"
                  className="input"
                  type="datetime-local"
                  {...availabilityForm.register("startsAt")}
                />
              </div>
              <div className="form-field">
                <label htmlFor="availability-end">Fine</label>
                <input
                  id="availability-end"
                  className="input"
                  type="datetime-local"
                  {...availabilityForm.register("endsAt")}
                />
                {availabilityForm.formState.errors.endsAt && (
                  <span className="field-error">
                    {availabilityForm.formState.errors.endsAt.message}
                  </span>
                )}
              </div>
              {availabilityMutation.error && (
                <div className="form-error form-field--full" role="alert">
                  {availabilityMutation.error.message}
                </div>
              )}
              <div className="form-actions">
                <button
                  className="button button--primary"
                  type="submit"
                  disabled={availabilityMutation.isPending}
                >
                  <CalendarPlus size={17} /> Apri disponibilità
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
              <p>La fascia deve rientrare interamente nella disponibilità</p>
            </div>
          </div>
          <form
            className="panel__body form-grid"
            onSubmit={allocationForm.handleSubmit((values) =>
              allocationMutation.mutate(values),
            )}
          >
            <div className="form-field">
              <label htmlFor="allocation-availability">Disponibilità</label>
              <select
                id="allocation-availability"
                className="select"
                defaultValue=""
                {...allocationForm.register("availabilityId")}
              >
                <option value="" disabled>
                  Seleziona aula e giornata
                </option>
                {availabilities
                  .filter((item) => item.status === "active")
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.roomName} · {formatDateTime(item.startsAt)}
                    </option>
                  ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="allocation-area">Area e campagna</label>
              <select
                id="allocation-area"
                className="select"
                defaultValue=""
                {...allocationForm.register("campaignAreaId")}
              >
                <option value="" disabled>
                  Seleziona area e recruitment
                </option>
                {campaignAreasQuery.data?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.areaName} · {item.campaignName}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="allocation-start">Inizio fascia</label>
              <input
                id="allocation-start"
                className="input"
                type="datetime-local"
                {...allocationForm.register("startsAt")}
              />
            </div>
            <div className="form-field">
              <label htmlFor="allocation-end">Fine fascia</label>
              <input
                id="allocation-end"
                className="input"
                type="datetime-local"
                {...allocationForm.register("endsAt")}
              />
              {allocationForm.formState.errors.endsAt && (
                <span className="field-error">
                  {allocationForm.formState.errors.endsAt.message}
                </span>
              )}
            </div>
            {allocationMutation.error && (
              <div className="form-error form-field--full" role="alert">
                {allocationMutation.error.message}
              </div>
            )}
            <div className="form-actions">
              <button
                className="button button--primary"
                type="submit"
                disabled={allocationMutation.isPending}
              >
                Conferma fascia
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="panel availability-list-panel">
        <div className="panel__header">
          <div>
            <h2>Disponibilità attive</h2>
            <p>{availabilities.length} fasce complessive</p>
          </div>
        </div>
        <div className="panel__body panel__body--flush">
          {availabilityQuery.isLoading ? (
            <div className="table-loading">Caricamento disponibilità…</div>
          ) : availabilities.length ? (
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Aula</th>
                    <th>Data e inizio</th>
                    <th>Fascia</th>
                    <th>Stato</th>
                    {isAdmin && <th>Azioni</th>}
                  </tr>
                </thead>
                <tbody>
                  {availabilities.map((availability) => (
                    <tr key={availability.id}>
                      <td>
                        <strong>{availability.roomName}</strong>
                      </td>
                      <td>{formatDateTime(availability.startsAt)}</td>
                      <td>
                        {formatTimeRange(
                          availability.startsAt,
                          availability.endsAt,
                        )}
                      </td>
                      <td>
                        <StatusBadge
                          label={
                            availability.status === "active"
                              ? "Aperta"
                              : "Annullata"
                          }
                          tone={
                            availability.status === "active"
                              ? "success"
                              : "neutral"
                          }
                        />
                        {availability.bookedInterviews > 0 && (
                          <span className="booking-count">
                            {availability.bookedInterviews} prenotati
                          </span>
                        )}
                      </td>
                      {isAdmin && (
                        <td>
                          <button
                            className="button button--danger button--small"
                            type="button"
                            disabled={
                              availability.status !== "active" ||
                              cancelMutation.isPending
                            }
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Vuoi annullare questa disponibilità? L'operazione verrà bloccata se contiene colloqui prenotati.",
                                )
                              ) {
                                cancelMutation.mutate(availability.id);
                              }
                            }}
                          >
                            <Trash2 size={15} /> Annulla
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={Warehouse}
              title="Nessuna disponibilità"
              description={
                isAdmin
                  ? "Aggiungi un'aula e apri la prima fascia per iniziare."
                  : "L’Amministrazione non ha ancora aperto fasce utilizzabili."
              }
            />
          )}
        </div>
      </section>
    </div>
  );
}

