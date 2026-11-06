-- Gestione merchandising: stessi permessi del Team Leader anche per Capo Logistica
-- e membri Logistica (membri attivi e account condivisi dell'area).
create or replace function private.can_manage_merchandising()
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.is_admin() or private.is_logistics_staff();
$$;
