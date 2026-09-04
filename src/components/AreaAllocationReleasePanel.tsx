import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { listMyAllocations } from "../lib/data";
import { friendlyError } from "../lib/errors";
import { romeInputToIso, toRomeInput } from "../lib/scheduling";
import { supabase } from "../lib/supabase";

export function AreaAllocationReleasePanel() {
  const queryClient = useQueryClient();
  const [range, setRange] = useState<Record<string, { start: string; end: string }>>({});
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["my-allocations"] }),
        queryClient.invalidateQueries({ queryKey: ["room-availabilities"] }),
      ]);
    },
  });

  const allocations = allocationsQuery.data ?? [];
  if (!allocations.length) return null;

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
          const isFull = current.start === toRomeInput(allocation.startsAt) && current.end === toRomeInput(allocation.endsAt);
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
                  <input className="input" type="datetime-local" min={toRomeInput(allocation.startsAt)} max={toRomeInput(allocation.endsAt)} value={current.start} onChange={(e) => setRange((prev) => ({ ...prev, [allocation.id]: { ...current, start: e.target.value } }))} />
                </label>
                <label className="form-field">
                  A
                  <input className="input" type="datetime-local" min={toRomeInput(allocation.startsAt)} max={toRomeInput(allocation.endsAt)} value={current.end} onChange={(e) => setRange((prev) => ({ ...prev, [allocation.id]: { ...current, end: e.target.value } }))} />
                </label>
              </div>
              {releaseMutation.error && releaseMutation.variables?.id === allocation.id && (
                <div className="form-error" role="alert">{releaseMutation.error.message}</div>
              )}
              <div className="form-actions">
                <button
                  className="button button--danger button--small"
                  type="button"
                  disabled={releaseMutation.isPending}
                  onClick={() => {
                    if (!window.confirm(isFull ? "Vuoi rilasciare tutta questa fascia?" : `Vuoi rilasciare ${current.start.replace("T", " ")} – ${current.end.replace("T", " ")}?`)) return;
                    releaseMutation.mutate({ id: allocation.id, start: current.start, end: current.end });
                  }}
                >
                  {releaseMutation.isPending && releaseMutation.variables?.id === allocation.id ? "Rilascio…" : isFull ? "Rilascia tutto" : "Rilascia intervallo"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
