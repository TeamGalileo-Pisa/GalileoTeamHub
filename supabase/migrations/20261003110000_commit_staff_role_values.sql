-- Enum values must commit before functions use them.
alter type public.app_role add value if not exists 'team_leader';
alter type public.app_role add value if not exists 'area_lead';
