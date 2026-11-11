import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { appConfig } from "../lib/config";
import { hhmm, slotEnd } from "../lib/meetings";
import { supabase } from "../lib/supabase";

type SlotStatus = "free" | "busy" | "unavailable";
interface StatusRow { room_name: string; location: string; slot_start: string | null; status: SlotStatus }

const LABELS: Record<SlotStatus, string> = { free: "Libera", busy: "Già occupata", unavailable: "Non disponibile" };
const MAX_DAYS_AHEAD = 60;

const todayInRome = () => new Intl.DateTimeFormat("en-CA", { timeZone: appConfig.timezone }).format(new Date());
const shiftDay = (day: string, delta: number) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
};
const longDay = (day: string) =>
  new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

/** Pagina pubblica: per ogni aula e slot mostra solo se è libera, non disponibile o già occupata. Nessun nome, nessun motivo. */
export function PublicMeetingRoomsPage() {
  const today = useMemo(todayInRome, []);
  const last = shiftDay(today, MAX_DAYS_AHEAD);
  const [day, setDay] = useState(today);

  const status = useQuery({
    queryKey: ["public-meeting-room-status", day],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("public_meeting_room_status", { p_day: day });
      if (error) throw error;
      return (data ?? []) as StatusRow[];
    },
  });

  const rooms = useMemo(() => {
    const byRoom = new Map<string, { location: string; slots: { start: string; status: SlotStatus }[]; closed: boolean }>();
    for (const row of status.data ?? []) {
      const room = byRoom.get(row.room_name) ?? { location: row.location, slots: [], closed: false };
      if (row.slot_start) room.slots.push({ start: hhmm(row.slot_start), status: row.status });
      else room.closed = true;
      byRoom.set(row.room_name, room);
    }
    return [...byRoom.entries()].map(([name, room]) => ({ name, ...room }));
  }, [status.data]);

  const go = (next: string) => { if (next >= today && next <= last) setDay(next); };

  return (
    <main className="public-info-page public-rooms-page">
      <header className="public-info-header">
        <Link className="public-info-brand" to="/">
          <img src="/icons/galileohub-192-v2.png" alt="" width="44" height="44" />
          <span>GalileoHub</span>
        </Link>
      </header>

      <section className="public-rooms">
        <h1>Disponibilità aule</h1>
        <p className="public-rooms__intro">Stato delle aule per le riunioni del Team Galileo Pisa.</p>

        <div className="public-rooms__daybar">
          <button className="icon-button" type="button" aria-label="Giorno precedente" disabled={day <= today} onClick={() => go(shiftDay(day, -1))}><ChevronLeft size={18} /></button>
          <div className="public-rooms__day">
            <strong>{longDay(day)}</strong>
            <input className="input" type="date" aria-label="Scegli il giorno" min={today} max={last} value={day} onChange={(e) => e.target.value && go(e.target.value)} />
          </div>
          <button className="icon-button" type="button" aria-label="Giorno successivo" disabled={day >= last} onClick={() => go(shiftDay(day, 1))}><ChevronRight size={18} /></button>
          {day !== today && <button className="button button--secondary button--small" type="button" onClick={() => setDay(today)}>Oggi</button>}
        </div>

        <ul className="public-rooms__legend" aria-label="Legenda">
          {(Object.keys(LABELS) as SlotStatus[]).map((key) => (
            <li key={key}><span className={`public-slot public-slot--${key}`} aria-hidden="true" /> {LABELS[key]}</li>
          ))}
        </ul>

        {status.isLoading ? <p>Caricamento…</p> : status.error ? (
          <p className="form-error" role="alert">Impossibile caricare le aule. Riprova tra poco.</p>
        ) : rooms.length === 0 ? (
          <p className="public-rooms__empty">Nessuna aula da mostrare per questo giorno.</p>
        ) : rooms.map((room) => (
          <article className="public-room" key={room.name}>
            <header>
              <h2>{room.name}</h2>
              {room.location && <p>{room.location}</p>}
            </header>
            {room.slots.length === 0 ? (
              <p className="public-room__closed"><span className="public-slot public-slot--unavailable" aria-hidden="true" /> Non disponibile</p>
            ) : (
              <div className="public-slots">
                {room.slots.map((slot) => (
                  <div key={slot.start} className={`public-slot public-slot--${slot.status}`}>
                    <strong>{slot.start}–{slotEnd(slot.start)}</strong>
                    <span>{LABELS[slot.status]}</span>
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}
        <p className="public-rooms__note">L'elenco si aggiorna automaticamente ogni minuto.</p>
      </section>
    </main>
  );
}
