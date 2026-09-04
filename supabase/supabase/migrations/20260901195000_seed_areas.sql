begin;

insert into public.areas (name, slug)
values
  ('Software', 'software'),
  ('Elettronica', 'elettronica'),
  ('Braccio', 'braccio'),
  ('Rover', 'rover'),
  ('Geologia', 'geologia'),
  ('Biologia', 'biologia'),
  ('Logistica', 'logistica'),
  ('Business', 'business'),
  ('Comunicazione', 'comunicazione')
on conflict (slug) do update
set name = excluded.name,
    active = true;

commit;
