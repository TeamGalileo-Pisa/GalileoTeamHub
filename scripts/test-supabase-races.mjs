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
await requireData(
  service
    .from("profiles")
    .update({ must_change_password: false })
    .in(
      "id",
      users.map((user) => user.id),
    ),
  "fixture password gate",
);
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
    p_email: `race-one-${suffix}@studenti.unipi.it`,
  }),
  service.rpc("book_public_slot", {
    p_token: token,
    p_slot_id: slotId,
    p_first_name: "Race",
    p_last_name: "Due",
    p_email: `race-two-${suffix}@studenti.unipi.it`,
  }),
]);
const bookingSuccesses = bookingRace.filter((result) => !result.error);
const bookingFailures = bookingRace.filter((result) =>
  result.error?.message.includes("SLOT_UNAVAILABLE"),
);
if (bookingSuccesses.length !== 1 || bookingFailures.length !== 1) {
  throw new Error("Race prenotazione: atteso un successo e un rifiuto.");
}

const firstBookingId = bookingSuccesses[0].data.booking_id;
const secondBooking = await requireData(
  service.rpc("book_public_slot", {
    p_token: token,
    p_slot_id: availability.slots[1].id,
    p_first_name: "Second",
    p_last_name: "Booking",
    p_email: `second-${suffix}@studenti.unipi.it`,
  }),
  "second booking",
);
const moveRace = await Promise.all(
  [firstBookingId, secondBooking.booking_id].map((id, index) =>
    leadClients[index].rpc("move_booking", {
      p_booking_id: id,
      p_new_slot_id: availability.slots[2].id,
    }),
  ),
);
if (
  moveRace.filter((r) => !r.error).length !== 1 ||
  moveRace.filter((r) => r.error?.message.includes("SLOT_UNAVAILABLE"))
    .length !== 1
)
  throw new Error("Race spostamento: atteso un successo e un rifiuto.");
const claimRace = await Promise.all(
  [1, 2].map(() =>
    service.rpc("claim_email_delivery", {
      p_delivery_id: bookingSuccesses[0].data.delivery_id,
    }),
  ),
);
if (claimRace.filter((r) => r.data && !r.error).length !== 1)
  throw new Error("Race email: una sola acquisizione richiesta.");
await requireData(
  leadClients[0].rpc("manage_session", {
    p_session_id: sessionId,
    p_action: "close",
  }),
  "chiusura sessione",
);
const afterClose = await service.rpc("book_public_slot", {
  p_token: token,
  p_slot_id: availability.slots[3].id,
  p_first_name: "Closed",
  p_last_name: "Session",
  p_email: `closed-${suffix}@studenti.unipi.it`,
});
if (!afterClose.error?.message.includes("INVALID_BOOKING_LINK"))
  throw new Error("Sessione chiusa prenotabile.");

if (process.env.RUN_LOCAL_EDGE_TESTS === "true") {
  await requireData(
    leadClients[0].rpc("manage_session", {
      p_session_id: sessionId,
      p_action: "reopen",
    }),
    "reopen for Edge test",
  );
  await requireData(
    leadClients[0].rpc("manage_slot", {
      p_slot_id: availability.slots[3].id,
      p_action: "reopen",
    }),
    "reopen Edge slot",
  );
  const edgeToken = await requireData(
    leadClients[0].rpc("rotate_booking_link", { p_session_id: sessionId }),
    "Edge booking token",
  );
  const edgeResponse = await fetch(url + "/functions/v1/public-booking", {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anonKey },
    body: JSON.stringify({
      action: "book",
      token: edgeToken,
      slotId: availability.slots[3].id,
      firstName: "Edge",
      lastName: "Test",
      email: `edge-${suffix}@studenti.unipi.it`,
    }),
  });
  if (edgeResponse.status !== 201)
    throw new Error("Edge booking did not return 201: " + edgeResponse.status);
  const booked = await edgeResponse.json();
  const { data: persisted } = await service
    .from("bookings")
    .select("status")
    .eq("id", booked.bookingId)
    .single();
  if (persisted?.status !== "confirmed")
    throw new Error("Edge booking not persisted");
  const denied = await fetch(url + "/functions/v1/process-email-queue", {
    method: "POST",
    headers: { "x-queue-token": "0".repeat(64) },
  });
  if (denied.status !== 401)
    throw new Error("Invalid queue credentials accepted");
  for (const name of ["staff-admin", "admin-email-test"]) {
    const r = await fetch(url + "/functions/v1/" + name, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + anonKey,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (r.status !== 401)
      throw new Error("Anonymous admin endpoint access: " + name);
  }
  process.stdout.write(
    "Edge HTTP tests passed: booking persisted, worker/admin endpoints reject anonymous requests.\n",
  );
}
process.stdout.write(
  "Test concorrenti superati: capacità, doppia prenotazione, spostamento e acquisizione email. Sessione chiusa non prenotabile.\n",
);
