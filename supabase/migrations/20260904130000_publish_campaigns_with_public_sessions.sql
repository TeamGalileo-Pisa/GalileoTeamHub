begin;

-- A public area link must expose every slot that the staff UI has published.
-- Older data can contain published sessions while their campaign is still in
-- draft status; the public calendar used to hide those slots completely.
-- A published session is an explicit signal that its campaign is bookable.
update public.recruitment_campaigns campaign
set status = 'active',
    updated_at = pg_catalog.now()
where campaign.status = 'draft'
  and exists (
    select 1
    from public.campaign_areas campaign_area
    join public.area_allocations allocation
      on allocation.campaign_area_id = campaign_area.id
    join public.interview_sessions session_record
      on session_record.allocation_id = allocation.id
    where campaign_area.campaign_id = campaign.id
      and campaign_area.active
      and allocation.status = 'active'
      and session_record.status = 'published'
  );

-- Keep the invariant true for future sessions as well: once a session is
-- published, its campaign must be active so the public area calendar can see
-- its slots.
create or replace function private.activate_campaign_for_published_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    update public.recruitment_campaigns campaign
    set status = 'active',
        updated_at = pg_catalog.now()
    where campaign.id = (
      select campaign_area.campaign_id
      from public.area_allocations allocation
      join public.campaign_areas campaign_area
        on campaign_area.id = allocation.campaign_area_id
      where allocation.id = new.allocation_id
    )
      and campaign.status = 'draft';
  end if;

  return new;
end;
$$;

revoke all on function private.activate_campaign_for_published_session() from public, anon, authenticated;

drop trigger if exists interview_sessions_activate_campaign on public.interview_sessions;
create trigger interview_sessions_activate_campaign
after insert or update of status on public.interview_sessions
for each row
execute function private.activate_campaign_for_published_session();

commit;
