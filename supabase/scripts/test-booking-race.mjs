const endpoint = process.env.PUBLIC_BOOKING_FUNCTION_URL;
const token = process.env.TEST_BOOKING_TOKEN;
const slotId = process.env.TEST_BOOKING_SLOT_ID;
const apiKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!endpoint || !token || !slotId || !apiKey) {
  throw new Error(
    "Configura PUBLIC_BOOKING_FUNCTION_URL, TEST_BOOKING_TOKEN, " +
      "TEST_BOOKING_SLOT_ID e VITE_SUPABASE_PUBLISHABLE_KEY",
  );
}

const request = (suffix) =>
  fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      action: "book",
      token,
      slotId,
      firstName: "Race",
      lastName: `Test ${suffix}`,
      email: `race-${suffix}-${Date.now()}@example.test`,
    }),
  });

const responses = await Promise.all([request("a"), request("b")]);
const statuses = responses.map((response) => response.status).sort();

if (statuses[0] !== 201 || statuses[1] !== 409) {
  throw new Error(`Risultato inatteso: HTTP ${statuses.join(", ")}`);
}

process.stdout.write("Test superato: una prenotazione accettata, una rifiutata.\n");

