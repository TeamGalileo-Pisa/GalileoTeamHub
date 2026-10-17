begin;

-- RIUNIONE: aule, disponibilità oraria per giorno e prenotazione di slot da 30 minuti.
-- Può usare la sezione (vedere e prenotare): Team Leader, Amministrazione e tutti i Capi Area.
-- Può aggiungere aule e orari: solo Team Leader e Amministrazione.

create or replace function private.can_manage_meeting_rooms()
returns boolean language sql stable security definer set search_path=''
as $$
  select auth.uid() is not null
    and exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active' and not p.must_change_password)
    and exists(select 1 from public.system_roles r where r.user_id=auth.uid() and r.role::text in ('admin','team_leader'));
$$;

create or replace function private.can_use_meeting_rooms()
returns boolean language sql stable security definer set search_path=''
as $$
  select private.can_manage_meeting_rooms()
    or (
      auth.uid() is not null
      and exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active' and not p.must_change_password)
      and exists(select 1 from public.area_memberships m join public.areas a on a.id=m.area_id
        where m.user_id=auth.uid() and m.role='area_lead' and m.ended_at is null and a.active)
    );
$$;
revoke all on function private.can_manage_meeting_rooms(), private.can_use_meeting_rooms() from public, anon;
grant execute on function private.can_manage_meeting_rooms(), private.can_use_meeting_rooms() to authenticated, service_role;

create table public.meeting_rooms(
  id uuid primary key default gen_random_uuid(),
  name text not null check(char_length(btrim(name)) between 2 and 120),
  location text not null default '' check(char_length(location)<=200),
  capacity integer check(capacity is null or capacity between 1 and 1000),
  notes text not null default '' check(char_length(notes)<=1000),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index meeting_rooms_name_idx on public.meeting_rooms(lower(btrim(name))) where active;

create table public.meeting_room_availability(
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.meeting_rooms(id) on delete cascade,
  day date not null,
  start_time time not null,
  end_time time not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check(end_time > start_time),
  check(extract(minute from start_time)::int in (0,30) and extract(second from start_time)=0),
  check(extract(minute from end_time)::int in (0,30) and extract(second from end_time)=0)
);
create index meeting_room_availability_day_idx on public.meeting_room_availability(day, room_id, start_time);

create table public.meeting_bookings(
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.meeting_rooms(id) on delete cascade,
  day date not null,
  slot_start time not null,
  title text not null check(char_length(btrim(title)) between 2 and 160),
  booked_by uuid not null references public.profiles(id) on delete cascade,
  booker_name text not null,
  created_at timestamptz not null default now(),
  constraint meeting_bookings_slot_unique unique(room_id, day, slot_start),
  check(extract(minute from slot_start)::int in (0,30) and extract(second from slot_start)=0)
);
create index meeting_bookings_day_idx on public.meeting_bookings(day, room_id, slot_start);

-- Gli intervalli di disponibilità della stessa aula nello stesso giorno non si possono sovrapporre,
-- e non si può ridurre/eliminare un intervallo che contiene già slot prenotati.
create or replace function private.guard_meeting_availability()
returns trigger language plpgsql set search_path=''
as $$
begin
  if tg_op in ('INSERT','UPDATE') then
    if exists(select 1 from public.meeting_room_availability a
      where a.room_id=new.room_id and a.day=new.day and a.id<>new.id
        and a.start_time < new.end_time and new.start_time < a.end_time) then
      raise exception 'MEETING_AVAILABILITY_OVERLAP';
    end if;
  end if;
  if tg_op in ('UPDATE','DELETE') then
    if exists(select 1 from public.meeting_bookings b
      where b.room_id=old.room_id and b.day=old.day
        and b.slot_start >= old.start_time and b.slot_start + interval '30 minutes' <= old.end_time
        and not (tg_op='UPDATE' and new.room_id=old.room_id and new.day=old.day
                 and b.slot_start >= new.start_time and b.slot_start + interval '30 minutes' <= new.end_time)) then
      raise exception 'MEETING_AVAILABILITY_HAS_BOOKINGS';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;
create trigger meeting_availability_guard before insert or update or delete on public.meeting_room_availability
  for each row execute function private.guard_meeting_availability();
revoke all on function private.guard_meeting_availability() from public, anon, authenticated;

alter table public.meeting_rooms enable row level security;
alter table public.meeting_room_availability enable row level security;
alter table public.meeting_bookings enable row level security;
revoke all on public.meeting_rooms, public.meeting_room_availability, public.meeting_bookings from public, anon, authenticated;
grant select, insert, update, delete on public.meeting_rooms, public.meeting_room_availability to authenticated;
grant select, delete on public.meeting_bookings to authenticated;
grant all on public.meeting_rooms, public.meeting_room_availability, public.meeting_bookings to service_role;

create policy meeting_rooms_read on public.meeting_rooms for select to authenticated using(private.can_use_meeting_rooms());
create policy meeting_rooms_write on public.meeting_rooms for insert to authenticated with check(private.can_manage_meeting_rooms());
create policy meeting_rooms_update on public.meeting_rooms for update to authenticated using(private.can_manage_meeting_rooms()) with check(private.can_manage_meeting_rooms());
create policy meeting_rooms_delete on public.meeting_rooms for delete to authenticated using(private.can_manage_meeting_rooms());

create policy meeting_availability_read on public.meeting_room_availability for select to authenticated using(private.can_use_meeting_rooms());
create policy meeting_availability_insert on public.meeting_room_availability for insert to authenticated with check(private.can_manage_meeting_rooms());
create policy meeting_availability_update on public.meeting_room_availability for update to authenticated using(private.can_manage_meeting_rooms()) with check(private.can_manage_meeting_rooms());
create policy meeting_availability_delete on public.meeting_room_availability for delete to authenticated using(private.can_manage_meeting_rooms());

create policy meeting_bookings_read on public.meeting_bookings for select to authenticated using(private.can_use_meeting_rooms());
create policy meeting_bookings_delete on public.meeting_bookings for delete to authenticated
  using(private.can_use_meeting_rooms() and (booked_by=(select auth.uid()) or private.can_manage_meeting_rooms()));

-- Prenota uno o più slot da 30 minuti (orari di inizio) per un'aula in un giorno, in un'unica operazione atomica.
create or replace function public.book_meeting_slots(p_room uuid, p_day date, p_starts time[], p_title text)
returns integer language plpgsql security definer set search_path=''
as $$
declare
  v_start time;
  v_now timestamp := (now() at time zone 'Europe/Rome');
  v_name text;
  v_count integer := 0;
begin
  if not private.can_use_meeting_rooms() then raise exception 'MEETING_NOT_ALLOWED'; end if;
  if p_starts is null or coalesce(array_length(p_starts,1),0)=0 then raise exception 'MEETING_NO_SLOTS'; end if;
  if char_length(btrim(coalesce(p_title,''))) < 2 then raise exception 'MEETING_TITLE_REQUIRED'; end if;
  if not exists(select 1 from public.meeting_rooms r where r.id=p_room and r.active) then raise exception 'MEETING_ROOM_NOT_FOUND'; end if;
  select coalesce(p.display_name,'Utente') into v_name from public.profiles p where p.id=auth.uid();

  for v_start in select distinct s from unnest(p_starts) s order by s loop
    if extract(minute from v_start)::int not in (0,30) or extract(second from v_start)<>0 then raise exception 'MEETING_SLOT_INVALID'; end if;
    if (p_day + v_start) < v_now then raise exception 'MEETING_SLOT_IN_THE_PAST'; end if;
    if not exists(select 1 from public.meeting_room_availability a
      where a.room_id=p_room and a.day=p_day and a.start_time <= v_start and a.end_time >= v_start + interval '30 minutes') then
      raise exception 'MEETING_SLOT_NOT_AVAILABLE';
    end if;
    begin
      insert into public.meeting_bookings(room_id,day,slot_start,title,booked_by,booker_name)
        values(p_room,p_day,v_start,btrim(p_title),auth.uid(),coalesce(v_name,'Utente'));
    exception when unique_violation then
      raise exception 'MEETING_SLOT_TAKEN';
    end;
    v_count := v_count + 1;
  end loop;
  return v_count;
end; $$;
revoke all on function public.book_meeting_slots(uuid,date,time[],text) from public, anon;
grant execute on function public.book_meeting_slots(uuid,date,time[],text) to authenticated, service_role;

commit;
