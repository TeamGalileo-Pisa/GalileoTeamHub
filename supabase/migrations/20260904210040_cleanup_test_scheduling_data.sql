begin;

-- One-time cleanup requested before GalileoHub becomes operational.
-- All current recruitment/scheduling records were created only for tests.
-- Deliberately preserved: auth users, profiles, roles, area memberships, areas,
-- rooms, announcements and stable per-area booking links.

delete from public.email_deliveries;
delete from public.booking_privacy_consents;

delete from public.audit_logs
where campaign_id is not null
   or entity_type in (
     'booking',
     'candidate',
     'slot',
     'interview_session',
     'area_allocation',
     'room_availability',
     'booking_link'
   );

delete from public.bookings;
delete from public.candidates;
delete from public.booking_links;
delete from public.slots;
delete from public.interview_sessions;
delete from public.area_allocations;
delete from public.room_availabilities;
delete from public.campaign_areas;
delete from public.recruitment_campaigns;

commit;
