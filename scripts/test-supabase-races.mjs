import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

if (
  process.env.ALLOW_LOCAL_SUPABASE_TESTS !== "true" ||
  !url ||
  !serviceKey ||
  !anonKey ||
  !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)
) {
  throw new Error(
    "Questo test può essere eseguito soltanto su Supabase locale con ALLOW_LOCAL_SUPABASE_TESTS=true.",
  );
}

const service = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const suffix = crypto.randomUUID().slice(0, 8);
const password = `Local-${crypto.randomUUID()}-1!`;

async function requireData(promise, label) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

const users = [];
for (const name of ["admin", "lead-a", "lead-b", "lead-c"]) {
  const data = await requireData(
    service.auth.admin.createUser({
      email: `${name}-${suffix}@example.com`,
      password,
      email_confirm: true,
      user_metadata: { username: `${name}-${suffix}`, display_name: name },
    }),
    `creazione ${name}`,
  );
  users.push({ name, id: data.user.id, email: data.user.email });
}

const admin = users[0];
const leads = users.slice(1);
const { id: softwareAreaId } = await requireData(
  service.from("areas").select("id").eq("name", "Software").single(),
  "lettura area Software",
);

await requireData(
  service.from("system_roles").insert({ user_id: admin.id, role: "admin" }),
  "ruolo admin",
);
await requireData(
  service.from("area_memberships").insert(
    leads.map((lead) => ({
      user_id: lead.id,
      area_id: softwareAreaId,
      role: "area_lead",
    })),
  ),
  "membership area",
);

const campaign = await requireData(
  service
    .from("recruitment_campaigns")
    .insert({
      name: `Race ${suffix}`,
      starts_on: "2099-01-01",
      ends_on: "2099-12-31",
      status: "active",
      created_by: admin.id,
    })
    .select("id")
    .single(),
  "campagna",
);
const campaignArea = await requireData(
  service
    .from("campaign_areas")
    .insert({ campaign_id: campaign.id, area_id: softwareAreaId })
    .select("id")
    .single(),
  "area campagna",
);
const room = await requireData(
  service
    .from("rooms")
    .insert({
      name: `Race room ${suffix}`,
      max_simultaneous_interviews_limit: 2,
    })
    .select("id")
    .single(),
  "aula",
);

async function authenticatedClient(user) {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (error) throw new Error(`login ${user.name}: ${error.message}`);
  return client;
}

const adminClient = await authenticatedClient(admin);
const leadClients = await Promise.all(leads.map(authenticatedClient));
const availabilityId = await requireData(
  adminClient.rpc("create_room_availability", {
    p_room_id: room.id,
    p_starts_at: "2099-09-15T07:00:00.000Z",
    p_ends_at: "2099-09-15T11:00:00.000Z",
    p_max_simultaneous_interviews: 2,
    p_area_note: "Test concorrenza locale",
  }),
  "disponibilità",
);

const firstAllocationId = await requireData(
  leadClients[0].rpc("claim_room_allocation", {
    p_availability_id: availabilityId,
    p_campaign_area_id: campaignArea.id,
    p_starts_at: "2099-09-15T07:00:00.000Z",
    p_ends_at: "2099-09-15T09:00:00.000Z",
  }),
  "prima allocazione",
);

const allocationRace = await Promise.all(
  leadClients.slice(1).map((client) =>
    client.rpc("claim_room_allocation", {
      p_availability_id: availabilityId,
      p_campaign_area_id: campaignArea.id,
      p_starts_at: "2099-09-15T07:30:00.000Z",
      p_ends_at: "2099-09-15T08:30:00.000Z",
    }),
  ),
);
const allocationSuccesses = allocationRace.filter((result) => !result.error);
const allocationFailures = allocationRace.filter((result) =>
  result.error?.message.includes("ROOM_CAPACITY_EXCEEDED"),
);
if (allocationSuccesses.length !== 1 || allocationFailures.length !== 1) {
  throw new Error("Race capacità: atteso un successo e un rifiuto.");
}

const sessionId = await requireData(
  leadClients[0].rpc("create_interview_session", {
    p_allocation_id: firstAllocationId,
    p_name: `Sessione race ${suffix}`,
  }),
  "sessione",
);
await requireData(
  leadClients[0].rpc("generate_session_slots", {
    p_session_id: sessionId,
    p_duration_minutes: 30,
  }),
  "slot",
);
const token = await requireData(
  leadClients[0].rpc("rotate_booking_link", { p_session_id: sessionId }),
  "booking link",
);
const availability = await requireData(
  service.rpc("get_public_booking_availability", { p_token: token }),
  "disponibilità pubblica",
);
const slotId = availability.slots[0]?.id;
if (!slotId) throw new Error("Nessuno slot creato per il race test.");

const bookingRace = await Promise.all([
  service.rpc("book_public_slot", {
    p_token: token,
    p_slot_id: slotId,
    p_first_name: "Race",
    p_last_name: "Uno",
    p_email: `race-one-${suffix}@example.com`,
  }),
  service.rpc("book_public_slot", {
    p_token: token,
    p_slot_id: slotId,
    p_first_name: "Race",
    p_last_name: "Due",
    p_email: `race-two-${suffix}@example.com`,
  }),
]);
const bookingSuccesses = bookingRace.filter((result) => !result.error);
const bookingFailures = bookingRace.filter((result) =>
  result.error?.message.includes("SLOT_UNAVAILABLE"),
);
if (bookingSuccesses.length !== 1 || bookingFailures.length !== 1) {
  throw new Error("Race prenotazione: atteso un successo e un rifiuto.");
}

process.stdout.write(
  "Test concorrenti superati: ultimo posto aula e doppia prenotazione sono serializzati.\n",
);
