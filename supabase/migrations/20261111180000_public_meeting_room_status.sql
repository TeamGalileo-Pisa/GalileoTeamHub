begin;

-- Stato pubblico delle aule: per ogni slot da 30 minuti solo "free" / "busy" / "unavailable".
-- Nessun dato personale: niente titolo della riunione, niente nome di chi prenota.
-- Visibile senza accesso, solo da oggi a 60 giorni (ora di Roma).
create or replace function public.public_meeting_room_status(p_day date)
returns table(room_name text, location text, slot_start time, status text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_now timestamp := (now() at time zone 'Europe/Rome');
  v_today date := v_now::date;
begin
  if p_day is null or p_day < v_today or p_day > v_today + 60 then
    return;
  end if;

  return query
  with rooms as (
    select r.id, r.name, r.location from public.meeting_rooms r where r.active
  ),
  bounds as (
    select a.room_id, min(a.start_time) as first_start, max(a.end_time) as last_end
    from public.meeting_room_availability a
    where a.day = p_day
    group by a.room_id
  ),
  slots as (
    select b.room_id, (g)::time as s
    from bounds b,
      generate_series(
        p_day::timestamp + b.first_start,
        p_day::timestamp + b.last_end - interval '30 minutes',
        interval '30 minutes'
      ) g
  )
  select r.name, r.location, sl.s,
    case
      when exists(select 1 from public.meeting_bookings bk
                  where bk.room_id = r.id and bk.day = p_day and bk.slot_start = sl.s) then 'busy'
      when (p_day + sl.s) < v_now then 'unavailable'
      when exists(select 1 from public.meeting_room_availability a
                  where a.room_id = r.id and a.day = p_day
                    and a.start_time <= sl.s and a.end_time >= sl.s + interval '30 minutes') then 'free'
      else 'unavailable'
    end
  from rooms r
  join slots sl on sl.room_id = r.id
  union all
  -- Aula senza alcuna disponibilità in quel giorno.
  select r.name, r.location, null::time, 'unavailable'
  from rooms r
  where not exists (select 1 from bounds b where b.room_id = r.id)
  order by 1, 3;
end;
$$;
revoke all on function public.public_meeting_room_status(date) from public;
grant execute on function public.public_meeting_room_status(date) to anon, authenticated, service_role;

commit;
