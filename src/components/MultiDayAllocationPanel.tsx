import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange } from "lucide-react";
import { useMemo, useState } from "react";
import { listMyCampaignAreas, listRoomAvailabilities } from "../lib/data";
import { claimRoomAllocationsBatch } from "../lib/hub-enhancements";
import { formatBookingDay, formatTimeRange } from "../lib/dates";
import { romeInputToIso, toRomeInput } from "../lib/scheduling";
import type { RoomAvailability } from "../types/domain";

type SelectedRange = { startsAt: string; endsAt: string };

export function MultiDayAllocationPanel() {
  const cache = useQueryClient();
  const [campaignAreaId, setCampaignAreaId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [selected, setSelected] = useState<Record<string, SelectedRange>>({});
  const [feedback, setFeedback] = useState<string | null>(null);

  const availabilityQuery = useQuery({
    queryKey: ["room-availabilities", "multi-day-allocation"],
    queryFn: listRoomAvailabilities,
  });
  const campaignAreasQuery = useQuery({
    queryKey: ["my-campaign-areas", "multi-day-allocation"],
    queryFn: listMyCampaignAreas,
  });

  const active = useMemo(
    () =>
      (availabilityQuery.data ?? [])
        .filter(
          (item) =>
            item.status === "active" && (!roomId || item.roomId === roomId),
        )
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [availabilityQuery.data, roomId],
  );

  const rooms = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of availabilityQuery.data ?? []) map.set(item.roomId, item.roomName);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "it"));
  }, [availabilityQuery.data]);

  const mutation = useMutation({
    mutationFn: async () => {
      const ranges = Object.entries(selected).map(([availabilityId, range]) => ({
        availabilityId,
        startsAt: romeInputToIso(range.startsAt),
        endsAt: romeInputToIso(range.endsAt),
      }));
      if (!campaignAreaId) throw new Error("Seleziona area e recruitment.");
      if (!ranges.length) throw new Error("Seleziona almeno una giornata.");
      for (const [availabilityId, range] of Object.entries(selected)) {
        const availability = (availabilityQuery.data ?? []).find((item) => item.id === availabilityId);
        if (!availability) throw new Error("Una disponibilità selezionata non è più disponibile.");
        const start = new Date(range.startsAt);
        const end = new Date(range.endsAt);
        const min = new Date(toRomeInput(availability.startsAt));
        const max = new Date(toRomeInput(availability.endsAt));
        if (!(end > start) || start < min || end > max) {
          throw new Error(`Controlla l'orario scelto per ${availability.roomName}: deve restare dentro la disponibilità dell'Amministrazione.`);
        }
      }
      return claimRoomAllocationsBatch({ campaignAreaId, ranges });
    },
    onMutate: () => setFeedback(null),
    onSuccess: async (result) => {
      setSelected({});
      setFeedback(`Prenotate ${result.count} fasce. Ora puoi creare le relative sessioni e gli slot.`);
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["room-availabilities"] }),
        cache.invalidateQueries({ queryKey: ["my-allocations"] }),
        cache.invalidateQueries({ queryKey: ["interview-sessions"] }),
      ]);
    },
  });

  function toggle(item: RoomAvailability) {
    setSelected((current) => {
      if (current[item.id]) {
        const next = { ...current };
        delete next[item.id];
        return next;
      }
      return {
        ...current,
        [item.id]: {
          startsAt: toRomeInput(item.startsAt),
          endsAt: toRomeInput(item.endsAt),
        },
      };
    });
  }

  function selectAllVisible() {
    const allSelected = active.length > 0 && active.every((item) => selected[item.id]);
    if (allSelected) {
      setSelected((current) => {
        const next = { ...current };
        for (const item of active) delete next[item.id];
        return next;
      });
      return;
    }
    setSelected((current) => {
      const next = { ...current };
      for (const item of active) {
        next[item.id] ??= {
          startsAt: toRomeInput(item.startsAt),
          endsAt: toRomeInput(item.endsAt),
        };
      }
      return next;
    });
  }

  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <h2>Scegli giorni e orari</h2>
          <p>
            L'Amministrazione apre le disponibilità. Tu puoi selezionare uno o più giorni e restringere l'orario di ogni giornata in modo indipendente.
          </p>
        </div>
        <CalendarRange size={20} />
      </div>
      <div className="panel__body">
        <div className="form-grid">
          <label className="form-field">
            Area e recruitment
            <select className="select" value={campaignAreaId} onChange={(event) => setCampaignAreaId(event.target.value)}>
              <option value="">Seleziona area e recruitment</option>
              {campaignAreasQuery.data?.map((item) => (
                <option key={item.id} value={item.id}>{item.areaName} · {item.campaignName}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            Aula
            <select className="select" value={roomId} onChange={(event) => setRoomId(event.target.value)}>
              <option value="">Tutte le aule</option>
              {rooms.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
        </div>

        <div className="form-actions">
          <button className="button button--secondary" type="button" disabled={!active.length} onClick={selectAllVisible}>
            {active.length > 0 && active.every((item) => selected[item.id])
              ? "Deseleziona tutte le giornate visibili"
              : "Seleziona tutte le giornate e tutti gli orari"}
          </button>
        </div>

        {availabilityQuery.isLoading || campaignAreasQuery.isLoading ? <p>Caricamento disponibilità…</p> : null}
        {(availabilityQuery.error || campaignAreasQuery.error) && (
          <p className="form-error" role="alert">{(availabilityQuery.error || campaignAreasQuery.error)?.message}</p>
        )}

        <div className="availability-cards">
          {active.map((item) => {
            const range = selected[item.id];
            const min = toRomeInput(item.startsAt);
            const max = toRomeInput(item.endsAt);
            return (
              <article className={`availability-card ${range ? "availability-card--selected" : ""}`} key={item.id}>
                <label className="filter-checkbox">
                  <input type="checkbox" checked={Boolean(range)} onChange={() => toggle(item)} />
                  <strong>{formatBookingDay(item.startsAt)} · {item.roomName}</strong>
                </label>
                <p>{formatTimeRange(item.startsAt, item.endsAt)} · {item.simultaneousUsage}/{item.maxSimultaneousInterviews} occupati</p>
                {item.areaNote && <p className="table-secondary">Nota: {item.areaNote}</p>}
                {range && (
                  <div className="form-grid">
                    <label className="form-field">
                      Da
                      <input
                        className="input"
                        type="datetime-local"
                        min={min}
                        max={max}
                        value={range.startsAt}
                        onChange={(event) => setSelected((current) => ({ ...current, [item.id]: { ...current[item.id], startsAt: event.target.value } }))}
                      />
                    </label>
                    <label className="form-field">
                      A
                      <input
                        className="input"
                        type="datetime-local"
                        min={min}
                        max={max}
                        value={range.endsAt}
                        onChange={(event) => setSelected((current) => ({ ...current, [item.id]: { ...current[item.id], endsAt: event.target.value } }))}
                      />
                    </label>
                  </div>
                )}
              </article>
            );
          })}
        </div>

        {!availabilityQuery.isLoading && !active.length && (
          <p>Nessuna disponibilità corrisponde ai filtri selezionati.</p>
        )}
        {mutation.error && <p className="form-error" role="alert">{mutation.error.message}</p>}
        {feedback && <p className="form-success" role="status">{feedback}</p>}
        <div className="form-actions">
          <button
            className="button button--primary"
            type="button"
            disabled={mutation.isPending || !campaignAreaId || Object.keys(selected).length === 0}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Prenotazione fasce…" : `Prenota ${Object.keys(selected).length || ""} ${Object.keys(selected).length === 1 ? "fascia" : "fasce"}`}
          </button>
        </div>
      </div>
    </section>
  );
}
