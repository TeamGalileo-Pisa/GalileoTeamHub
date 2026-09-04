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

commit;
