import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useMemo, useState } from "react";
import { friendlyError } from "../lib/errors";
import { supabase } from "../lib/supabase";
import type { Room } from "../types/domain";

export function RoomEditorPanel({ rooms }: { rooms: Room[] }) {
  const [roomId, setRoomId] = useState("");
  const room = useMemo(
    () => rooms.find((item) => item.id === roomId) ?? null,
    [roomId, rooms],
  );

  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <h2>Modifica aula</h2>
          <p>Aggiorna nome, posizione e limite fisico senza ricreare l'aula.</p>
        </div>
        <Pencil size={20} />
      </div>
      <div className="panel__body form-grid">
        <label className="form-field form-field--full">
          Aula
          <select
            className="select"
            value={roomId}
            onChange={(event) => setRoomId(event.target.value)}
          >
            <option value="">Seleziona aula</option>
            {rooms.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        {room && <RoomEditorForm key={room.id} room={room} />}
      </div>
    </section>
  );
}

function RoomEditorForm({ room }: { room: Room }) {
  const cache = useQueryClient();
  const [name, setName] = useState(room.name);
  const [location, setLocation] = useState(room.location ?? "");
  const [physicalLimit, setPhysicalLimit] = useState(
    room.maxSimultaneousInterviewsLimit == null
      ? ""
      : String(room.maxSimultaneousInterviewsLimit),
  );
  const [feedback, setFeedback] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const cleanName = name.trim();
      if (cleanName.length < 2) throw new Error("Inserisci il nome dell'aula.");

      const cleanLimit = physicalLimit.trim();
      let parsedLimit: number | null = null;
      if (cleanLimit) {
        if (!/^\d+$/.test(cleanLimit)) {
          throw new Error("La capacità deve essere un numero intero tra 1 e 100.");
        }
        parsedLimit = Number(cleanLimit);
        if (parsedLimit < 1 || parsedLimit > 100) {
          throw new Error("La capacità deve essere compresa tra 1 e 100.");
        }
      }

      const { error } = await supabase
        .from("rooms")
        .update({
          name: cleanName,
          location: location.trim() || null,
          max_simultaneous_interviews_limit: parsedLimit,
        })
        .eq("id", room.id);

      if (error) throw friendlyError(error);
    },
    onMutate: () => setFeedback(null),
    onSuccess: async () => {
      setFeedback("Aula aggiornata correttamente.");
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["rooms"] }),
        cache.invalidateQueries({ queryKey: ["room-availabilities"] }),
      ]);
    },
  });

  return (
    <>
      <label className="form-field">
        Nome aula
        <input
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="form-field">
        Posizione
        <input
          className="input"
          value={location}
          onChange={(event) => setLocation(event.target.value)}
        />
      </label>
      <label className="form-field form-field--full">
        Limite fisico simultaneo
        <input
          className="input"
          inputMode="numeric"
          placeholder="Vuoto = nessun limite fisico configurato"
          value={physicalLimit}
          onChange={(event) => setPhysicalLimit(event.target.value)}
        />
        <small className="field-help">
          Il database impedisce di impostare un limite inferiore alla capacità già configurata nelle disponibilità attive dell'aula.
        </small>
      </label>
      {mutation.error && (
        <div className="form-error form-field--full" role="alert">
          {mutation.error.message}
        </div>
      )}
      {feedback && (
        <div className="form-success form-field--full" role="status">
          {feedback}
        </div>
      )}
      <div className="form-actions">
        <button
          className="button button--primary"
          type="button"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          <Pencil size={16} /> {mutation.isPending ? "Salvataggio…" : "Salva modifiche aula"}
        </button>
      </div>
    </>
  );
}
