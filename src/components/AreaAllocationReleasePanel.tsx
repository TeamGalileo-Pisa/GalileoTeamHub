import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { listMyAllocations } from "../lib/data";
import { friendlyError } from "../lib/errors";
import { deleteAreaAllocationPermanently } from "../lib/hub-enhancements";
import { romeInputToIso, toRomeInput } from "../lib/scheduling";
import { supabase } from "../lib/supabase";
import { CancelDeleteDialog } from "./CancelDeleteDialog";

export function AreaAllocationReleasePanel() {
  const queryClient = useQueryClient();
  const [range, setRange] = useState<Record<string, { start: string; end: string }>>({});
  const [lifecycleId, setLifecycleId] = useState<string | null>(null);
  const allocationsQuery = useQuery({ queryKey: ["my-allocations"], queryFn: listMyAllocations });

  const releaseMutation = useMutation({
    mutationFn: async ({ id, start, end }: { id: string; start: string; end: string }) => {
      const { error } = await supabase.rpc("release_area_allocation_interval", {
        p_allocation_id: id,
        p_starts_at: romeInputToIso(start),
        p_ends_at: romeInputToIso(end),
      });
      if (error) throw friendlyError(error);
    },
    onSuccess: async () => {
      setLifecycleId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["my-allocations"] }),
        queryClient.invalidateQueries({ queryKey: ["room-availabilities"] }),
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["interview-sessions"] }),
      ]);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAreaAllocationPermanently(id),
    onSuccess: async () => {
      setLifecycleId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["my-allocations"] }),
        queryClient.invalidateQueries({ queryKey: ["room-availabilities"] }),
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["interview-sessions"] }),
      ]);
    },
  });

  const allocations = allocationsQuery.data ?? [];
  if (!allocations.length) return null;

  const lifecycleAllocation = allocations.find((allocation) => allocation.id === lifecycleId) ?? null;

  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <h2>Le mie assegnazioni</h2>
          <p>Puoi restituire tutta o parte della fascia assegnata alla tua area.</p>
        </div>
        <RotateCcw size={20} />
      </div>
      <div className="panel__body">
        {allocations.map((allocation) => {
          const current = range[allocation.id] ?? {
            start: toRomeInput(allocation.startsAt),
            end: toRomeInput(allocation.endsAt),
          };
          const isFull =
            current.start === toRomeInput(allocation.startsAt) &&
            current.end === toRomeInput(allocation.endsAt);
          const pending = releaseMutation.isPending || deleteMutation.isPending;

          return (
            <div key={allocation.id} className="panel allocation-release-row">
              <div>
                <strong>{allocation.roomName}</strong>
                <div className="table-secondary">
                  {allocation.areaName} · {toRomeInput(allocation.startsAt).replace("T", " ")} – {toRomeInput(allocation.endsAt).slice(11)}
                </div>
              </div>
              <div className="form-grid">
                <label className="form-field">
                  Da
                  <input
                    className="input"
                    type="datetime-local"
                    min={toRomeInput(allocation.startsAt)}
                    max={toRomeInput(allocation.endsAt)}
                    value={current.start}
                    onChange={(event) =>
                      setRange((previous) => ({
                        ...previous,
                        [allocation.id]: { ...current, start: event.target.value },
                      }))
                    }
                  />
                </label>
                <label className="form-field">
                  A
                  <input
                    className="input"
                    type="datetime-local"
                    min={toRomeInput(allocation.startsAt)}
                    max={toRomeInput(allocation.endsAt)}
                    value={current.end}
                    onChange={(event) =>
                      setRange((previous) => ({
                        ...previous,
                        [allocation.id]: { ...current, end: event.target.value },
                      }))
                    }
                  />
                </label>
              </div>
              {releaseMutation.error && releaseMutation.variables?.id === allocation.id && (
                <div className="form-error" role="alert">{releaseMutation.error.message}</div>
              )}
              {deleteMutation.error && deleteMutation.variables === allocation.id && (
                <div className="form-error" role="alert">{deleteMutation.error.message}</div>
              )}
              <div className="form-actions">
                <button
                  className="button button--danger button--small"
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (isFull) {
                      setLifecycleId(allocation.id);
                      return;
                    }
                    if (!window.confirm(`Vuoi rilasciare ${current.start.replace("T", " ")} – ${current.end.replace("T", " ")}? La parte rilasciata tornerà disponibile alle altre aree.`)) return;
                    releaseMutation.mutate({ id: allocation.id, start: current.start, end: current.end });
                  }}
                >
                  {pending && (releaseMutation.variables?.id === allocation.id || deleteMutation.variables === allocation.id)
                    ? "Operazione…"
                    : isFull
                      ? "Rilascia / annulla tutto…"
                      : "Rilascia intervallo"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {lifecycleAllocation && (
        <CancelDeleteDialog
          title="Come vuoi restituire tutta la fascia?"
          description="Conservandola, la fascia viene rilasciata e rimane nello storico del gestionale secondo le regole di annullamento. Eliminandola definitivamente, viene rimossa insieme alla sessione e ai dati di scheduling collegati. In entrambi i casi la capacità torna disponibile alle altre aree."
          itemLabel="L'assegnazione"
          pending={releaseMutation.isPending || deleteMutation.isPending}
          error={(releaseMutation.error || deleteMutation.error)?.message}
          onClose={() => setLifecycleId(null)}
          onCancelOnly={() =>
            releaseMutation.mutate({
              id: lifecycleAllocation.id,
              start: toRomeInput(lifecycleAllocation.startsAt),
              end: toRomeInput(lifecycleAllocation.endsAt),
            })
          }
          onCancelAndDelete={() => deleteMutation.mutate(lifecycleAllocation.id)}
        />
      )}
    </section>
  );
}
