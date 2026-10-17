import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, ChevronLeft, ChevronRight, DoorOpen, Plus, Trash2, Users } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../hooks/useAuth";
import { appConfig } from "../lib/config";
import { describeSlotRanges, hhmm, meetingErrorMessage, slotEnd, slotsFromWindows } from "../lib/meetings";
import { supabase } from "../lib/supabase";

interface Room { id: string; name: string; location: string; capacity: number | null; notes: string; active: boolean }
interface Availability { id: string; room_id: string; day: string; start_time: string; end_time: string }
interface Booking { id: string; room_id: string; day: string; slot_start: string; title: string; booked_by: string; booker_name: string }

const todayInRome = () => new Intl.DateTimeFormat("en-CA", { timeZone: appConfig.timezone }).format(new Date());
const nowTimeInRome = () =>
  new Intl.DateTimeFormat("it-IT", { timeZone: appConfig.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
const shiftDay = (day: string, delta: number) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
};
const longDay = (day: string) =>
  new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
const daysBetween = (from: string, to: string) => {
  const days: string[] = [];
  for (let d = from; d <= to && days.length < 92; d = shiftDay(d, 1)) days.push(d);
  return days;
};

export function MeetingRoomsPage() {
  const { access } = useAuth();
  const cache = useQueryClient();
  const canManage = Boolean(access?.isAdmin);
  const canUse = Boolean(access && !access.isMember && (access.isAdmin || access.areas.length > 0));
  const [day, setDay] = useState(todayInRome);
  const [selection, setSelection] = useState<{ roomId: string; starts: string[] } | null>(null);
  const [title, setTitle] = useState("");
  const [roomDraft, setRoomDraft] = useState({ name: "", location: "", capacity: "" });
  const [windowDraft, setWindowDraft] = useState({ roomId: "", from: "09:00", to: "13:00", until: "" });

  const rooms = useQuery({
    queryKey: ["meeting-rooms"], enabled: canUse,
    queryFn: async () => {
      const { data, error } = await supabase.from("meeting_rooms").select("*").eq("active", true).order("name");
      if (error) throw error;
      return data as Room[];
    },
  });
  const availability = useQuery({
    queryKey: ["meeting-availability", day], enabled: canUse,
    queryFn: async () => {
      const { data, error } = await supabase.from("meeting_room_availability").select("*").eq("day", day).order("start_time");
      if (error) throw error;
      return data as Availability[];
    },
  });
  const bookings = useQuery({
    queryKey: ["meeting-bookings", day], enabled: canUse,
    queryFn: async () => {
      const { data, error } = await supabase.from("meeting_bookings").select("*").eq("day", day).order("slot_start");
      if (error) throw error;
      return data as Booking[];
    },
  });

  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ["meeting-rooms"] });
    void cache.invalidateQueries({ queryKey: ["meeting-availability"] });
    void cache.invalidateQueries({ queryKey: ["meeting-bookings"] });
  };

  const addRoom = useMutation({
    mutationFn: async () => {
      const capacity = roomDraft.capacity.trim() ? Number(roomDraft.capacity) : null;
      const { error } = await supabase.from("meeting_rooms").insert({
        name: roomDraft.name.trim(), location: roomDraft.location.trim(), capacity, created_by: access?.userId,
      });
      if (error) throw error;
    },
    onSuccess: () => { setRoomDraft({ name: "", location: "", capacity: "" }); refresh(); },
  });
  const removeRoom = useMutation({
    mutationFn: async (room: Room) => {
      const { error } = await supabase.from("meeting_rooms").update({ active: false }).eq("id", room.id);
      if (error) throw error;
    },
    onSuccess: refresh,
  });
  const addWindow = useMutation({
    mutationFn: async () => {
      const roomId = windowDraft.roomId || rooms.data?.[0]?.id;
      if (!roomId) throw new Error("Aggiungi prima un'aula.");
      if (windowDraft.to <= windowDraft.from) throw new Error("L'orario di fine deve essere dopo quello di inizio.");
      const until = windowDraft.until && windowDraft.until >= day ? windowDraft.until : day;
      const rows = daysBetween(day, until).map((d) => ({
        room_id: roomId, day: d, start_time: `${windowDraft.from}:00`, end_time: `${windowDraft.to}:00`, created_by: access?.userId,
      }));
      const { error } = await supabase.from("meeting_room_availability").insert(rows);
      if (error) throw error;
    },
    onSuccess: refresh,
  });
  const removeWindow = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("meeting_room_availability").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
  });
  const book = useMutation({
    mutationFn: async () => {
      if (!selection) return;
      const { error } = await supabase.rpc("book_meeting_slots", {
        p_room: selection.roomId, p_day: day, p_starts: selection.starts.map((s) => `${s}:00`), p_title: title.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => { setSelection(null); setTitle(""); refresh(); },
    onError: refresh,
  });
  const cancel = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from("meeting_bookings").delete().in("id", ids);
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const today = todayInRome();
  const nowTime = nowTimeInRome();
  const isPast = (start: string) => day < today || (day === today && start < nowTime);

  const perRoom = useMemo(() => (rooms.data ?? []).map((room) => {
    const windows = (availability.data ?? []).filter((w) => w.room_id === room.id);
    const booked = new Map((bookings.data ?? []).filter((b) => b.room_id === room.id).map((b) => [hhmm(b.slot_start), b]));
    return { room, windows, booked, slots: slotsFromWindows(windows) };
  }), [rooms.data, availability.data, bookings.data]);

  const toggleSlot = (roomId: string, start: string) => {
    setSelection((current) => {
      if (!current || current.roomId !== roomId) return { roomId, starts: [start] };
      const starts = current.starts.includes(start) ? current.starts.filter((s) => s !== start) : [...current.starts, start].sort();
      return starts.length ? { roomId, starts } : null;
    });
  };

  const error = rooms.error ?? availability.error ?? bookings.error ?? addRoom.error ?? removeRoom.error ?? addWindow.error ?? removeWindow.error ?? book.error ?? cancel.error;

  if (!canUse) {
    return <div className="page-container"><PageHeader title="Riunione" eyebrow="Accesso riservato" description="Questa sezione è disponibile a Team Leader, Amministrazione e Capi Area." /></div>;
  }

  return (
    <div className="page-container meeting-page">
      <PageHeader title="Riunione" eyebrow="Team Leader · Amministrazione · Capi Area" description="Scegli il giorno, seleziona uno o più slot da 30 minuti e prenota l'aula." />
      {error && <p className="form-error" role="alert">{meetingErrorMessage(error)}</p>}

      <section className="panel panel__body meeting-daybar">
        <button className="icon-button" type="button" aria-label="Giorno precedente" onClick={() => { setDay(shiftDay(day, -1)); setSelection(null); }}><ChevronLeft size={18} /></button>
        <div className="meeting-daybar__current">
          <strong>{longDay(day)}</strong>
          <input className="input" type="date" aria-label="Scegli il giorno" value={day} onChange={(e) => { if (e.target.value) { setDay(e.target.value); setSelection(null); } }} />
        </div>
        <button className="icon-button" type="button" aria-label="Giorno successivo" onClick={() => { setDay(shiftDay(day, 1)); setSelection(null); }}><ChevronRight size={18} /></button>
        <button className="button button--secondary button--small" type="button" onClick={() => { setDay(today); setSelection(null); }}>Oggi</button>
      </section>

      {canManage && (
        <section className="panel panel__body meeting-manage">
          <h2><DoorOpen size={18} /> Gestione aule</h2>
          <form className="meeting-form" onSubmit={(e) => { e.preventDefault(); addRoom.mutate(); }}>
            <label className="form-field">Nuova aula *<input className="input" required minLength={2} maxLength={120} value={roomDraft.name} onChange={(e) => setRoomDraft({ ...roomDraft, name: e.target.value })} placeholder="Es. Aula 3" /></label>
            <label className="form-field">Posizione<input className="input" maxLength={200} value={roomDraft.location} onChange={(e) => setRoomDraft({ ...roomDraft, location: e.target.value })} placeholder="Es. Piano terra" /></label>
            <label className="form-field">Posti<input className="input" type="number" min={1} max={1000} value={roomDraft.capacity} onChange={(e) => setRoomDraft({ ...roomDraft, capacity: e.target.value })} /></label>
            <button className="button button--primary" disabled={addRoom.isPending}><Plus size={16} /> Aggiungi aula</button>
          </form>
          <form className="meeting-form" onSubmit={(e) => { e.preventDefault(); addWindow.mutate(); }}>
            <label className="form-field">Aula
              <select className="input" value={windowDraft.roomId || rooms.data?.[0]?.id || ""} onChange={(e) => setWindowDraft({ ...windowDraft, roomId: e.target.value })}>
                {(rooms.data ?? []).map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
              </select>
            </label>
            <label className="form-field">Dalle<input className="input" type="time" step={1800} required value={windowDraft.from} onChange={(e) => setWindowDraft({ ...windowDraft, from: e.target.value })} /></label>
            <label className="form-field">Alle<input className="input" type="time" step={1800} required value={windowDraft.to} onChange={(e) => setWindowDraft({ ...windowDraft, to: e.target.value })} /></label>
            <label className="form-field">Ripeti fino al (facoltativo)<input className="input" type="date" min={day} value={windowDraft.until} onChange={(e) => setWindowDraft({ ...windowDraft, until: e.target.value })} /></label>
            <button className="button button--primary" disabled={addWindow.isPending || !rooms.data?.length}><Plus size={16} /> Aggiungi disponibilità per {longDay(day).split(" ").slice(0, 3).join(" ")}</button>
          </form>
        </section>
      )}

      {rooms.isLoading ? <p>Caricamento aule…</p> : perRoom.length === 0 ? (
        <section className="panel panel__body meeting-empty"><DoorOpen size={24} /><strong>Nessuna aula disponibile</strong><span>{canManage ? "Aggiungi la prima aula qui sopra." : "Team Leader e Amministrazione devono ancora aggiungere le aule."}</span></section>
      ) : perRoom.map(({ room, windows, booked, slots }) => {
        const selected = selection?.roomId === room.id ? selection.starts : [];
        return (
          <section className="panel panel__body meeting-room" key={room.id}>
            <header className="meeting-room__header">
              <div>
                <h2>{room.name}</h2>
                <p>{[room.location, room.capacity ? `${room.capacity} posti` : ""].filter(Boolean).join(" · ") || "Aula"}</p>
              </div>
              {canManage && <button className="button button--secondary button--small" type="button" onClick={() => { if (window.confirm(`Rimuovere l'aula ${room.name}?`)) removeRoom.mutate(room); }}><Trash2 size={14} /> Rimuovi aula</button>}
            </header>

            {slots.length === 0 ? <p className="meeting-room__none">Nessuna disponibilità in questo giorno.</p> : (
              <>
                <p className="meeting-room__hours"><CalendarCheck size={14} /> Disponibile: {windows.map((w) => (
                  <span key={w.id} className="meeting-chip">{hhmm(w.start_time)}–{hhmm(w.end_time)}
                    {canManage && <button type="button" className="meeting-chip__remove" aria-label={`Elimina fascia ${hhmm(w.start_time)}–${hhmm(w.end_time)}`} onClick={() => removeWindow.mutate(w.id)}>×</button>}
                  </span>
                ))}</p>
                <div className="meeting-slots" role="group" aria-label={`Slot di ${room.name}`}>
                  {slots.map((start) => {
                    const taken = booked.get(start);
                    const mine = taken?.booked_by === access?.userId;
                    const past = isPast(start);
                    const isSelected = selected.includes(start);
                    if (taken) {
                      return (
                        <div key={start} className={`meeting-slot meeting-slot--booked${mine ? " meeting-slot--mine" : ""}`}>
                          <strong>{start}–{slotEnd(start)}</strong>
                          <span>{taken.title}</span>
                          <small>{taken.booker_name}</small>
                          {(mine || canManage) && !past && <button type="button" className="meeting-slot__cancel" onClick={() => cancel.mutate([taken.id])}>Cancella</button>}
                        </div>
                      );
                    }
                    return (
                      <button key={start} type="button" disabled={past} aria-pressed={isSelected}
                        className={`meeting-slot meeting-slot--free${isSelected ? " meeting-slot--selected" : ""}`}
                        onClick={() => toggleSlot(room.id, start)}>
                        <strong>{start}–{slotEnd(start)}</strong>
                        <span>{past ? "Passato" : isSelected ? "Selezionato" : "Libero"}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {selected.length > 0 && (
              <form className="meeting-book" onSubmit={(e) => { e.preventDefault(); book.mutate(); }}>
                <p><Users size={14} /> {selected.length} {selected.length === 1 ? "slot" : "slot"}: {describeSlotRanges(selected).join(", ")}</p>
                <input className="input" required minLength={2} maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Motivo / nome della riunione" aria-label="Motivo della riunione" />
                <button className="button button--primary" disabled={book.isPending}>{book.isPending ? "Prenotazione…" : "Prenota"}</button>
                <button className="button button--secondary" type="button" onClick={() => setSelection(null)}>Annulla</button>
              </form>
            )}
          </section>
        );
      })}
    </div>
  );
}
