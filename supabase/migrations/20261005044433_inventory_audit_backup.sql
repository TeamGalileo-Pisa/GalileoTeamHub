begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('inventory-audit','inventory-audit',false,52428800,array['text/csv'])
on conflict(id) do update set public=false,allowed_mime_types=array['text/csv'];

create policy inventory_audit_read on storage.objects
for select to authenticated
using(bucket_id='inventory-audit' and name='registro-magazzino.csv' and private.can_manage_logistics_inventory());

create policy inventory_audit_insert on storage.objects
for insert to authenticated
with check(bucket_id='inventory-audit' and name='registro-magazzino.csv' and private.can_manage_logistics_inventory());

create policy inventory_audit_update on storage.objects
for update to authenticated
using(bucket_id='inventory-audit' and name='registro-magazzino.csv' and private.can_manage_logistics_inventory())
with check(bucket_id='inventory-audit' and name='registro-magazzino.csv' and private.can_manage_logistics_inventory());

commit;
