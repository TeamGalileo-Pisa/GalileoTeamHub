begin;

create index if not exists member_adhesions_area_id_idx
  on public.member_adhesions(area_id);
create index if not exists member_adhesions_submitted_by_idx
  on public.member_adhesions(submitted_by);

commit;

