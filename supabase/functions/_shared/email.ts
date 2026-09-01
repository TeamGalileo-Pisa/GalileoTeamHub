import type { SupabaseClient } from "npm:@supabase/supabase-js@2.112.4";

interface DeliveryPayload {
  delivery_id: string;
  kind:
    | "booking_confirmation"
    | "booking_reminder"
    | "booking_cancelled"
    | "booking_changed";
  to_email: string;
  candidate_name: string;
  area_name: string;
  room_name: string;
  starts_at: string;
  ends_at: string;
}

interface GmailMessage {
  to: string;
  subject: string;
  text: string;
  idempotencyId: string;
}

const OFFICIAL_EMAIL = "info.teamgalileo@gmail.com";
export const OFFICIAL_EMAIL_FROM = `Team Galileo Pisa <${OFFICIAL_EMAIL}>`;

const formatter = new Intl.DateTimeFormat("it-IT", {
  timeZone: "Europe/Rome",
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function utf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Url(value: string): string {
  return utf8Base64(value)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function safeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function messageId(idempotencyId: string): string {
  const safeId = idempotencyId.replace(/[^a-zA-Z0-9._-]/g, "-");
  return `<${safeId}@colloqui.teamgalileo.local>`;
}

function buildRawMessage(message: GmailMessage): string {
  const headers = [
    `From: ${OFFICIAL_EMAIL_FROM}`,
    `To: ${safeHeader(message.to)}`,
    `Subject: =?UTF-8?B?${utf8Base64(message.subject)}?=`,
    `Message-ID: ${messageId(message.idempotencyId)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    utf8Base64(message.text),
  ];
  return base64Url(headers.join("\r\n"));
}

async function gmailAccessToken(): Promise<string> {
  const clientId = Deno.env.get("GMAIL_CLIENT_ID");
  const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
  const refreshToken = Deno.env.get("GMAIL_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("EMAIL_NOT_CONFIGURED");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error("GMAIL_OAUTH_FAILED");

  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) throw new Error("GMAIL_OAUTH_FAILED");
  return payload.access_token;
}

async function findExistingMessage(
  accessToken: string,
  idempotencyId: string,
): Promise<string | null> {
  const query = encodeURIComponent(`rfc822msgid:${messageId(idempotencyId)}`);
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=1`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) throw new Error("GMAIL_LOOKUP_FAILED");

  const payload = (await response.json()) as { messages?: Array<{ id?: string }> };
  return payload.messages?.[0]?.id ?? null;
}

export async function sendGmailMessage(message: GmailMessage): Promise<string> {
  const accessToken = await gmailAccessToken();
  const existingId = await findExistingMessage(accessToken, message.idempotencyId);
  if (existingId) return existingId;

  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: buildRawMessage(message) }),
    },
  );
  if (!response.ok) throw new Error(`GMAIL_SEND_FAILED:${response.status}`);

  const payload = (await response.json()) as { id?: string };
  if (!payload.id) throw new Error("GMAIL_SEND_FAILED");
  return payload.id;
}

function emailCopy(payload: DeliveryPayload) {
  const appointment = formatter.format(new Date(payload.starts_at));
  const subjectByKind = {
    booking_confirmation: `Prenotazione confermata · ${payload.area_name}`,
    booking_reminder: `Promemoria colloquio · ${payload.area_name}`,
    booking_cancelled: `Colloquio annullato · ${payload.area_name}`,
    booking_changed: `Colloquio modificato · ${payload.area_name}`,
  };
  const headingByKind = {
    booking_confirmation: "La tua prenotazione è confermata",
    booking_reminder: "Ti ricordiamo il tuo colloquio",
    booking_cancelled: "Il tuo colloquio è stato annullato",
    booking_changed: "I dettagli del tuo colloquio sono cambiati",
  };

  return {
    subject: subjectByKind[payload.kind],
    text: [
      `Ciao ${payload.candidate_name},`,
      "",
      `${headingByKind[payload.kind]}.`,
      `Area: ${payload.area_name}`,
      `Data e ora: ${appointment}`,
      `Aula: ${payload.room_name}`,
      "",
      "Team Galileo Pisa",
    ].join("\n"),
  };
}

async function markFailed(
  client: SupabaseClient,
  deliveryId: string,
  error: unknown,
) {
  await client.rpc("mark_email_delivery_failed", {
    p_delivery_id: deliveryId,
    p_error: error instanceof Error ? error.message : "Email provider error",
  });
}

export async function sendQueuedEmail(
  client: SupabaseClient,
  deliveryId: string,
): Promise<void> {
  const { data, error } = await client.rpc("claim_email_delivery", {
    p_delivery_id: deliveryId,
  });
  if (error) throw error;
  if (!data) return;

  const payload = data as DeliveryPayload;
  const provider = Deno.env.get("EMAIL_PROVIDER") ?? "development";

  try {
    if (provider === "development") {
      await client.rpc("mark_email_delivery_sent", {
        p_delivery_id: deliveryId,
        p_provider_message_id: `development:${deliveryId}`,
      });
      return;
    }
    if (provider !== "gmail") throw new Error("EMAIL_NOT_CONFIGURED");

    const message = emailCopy(payload);
    const providerMessageId = await sendGmailMessage({
      to: payload.to_email,
      subject: message.subject,
      text: message.text,
      idempotencyId: payload.delivery_id,
    });
    await client.rpc("mark_email_delivery_sent", {
      p_delivery_id: deliveryId,
      p_provider_message_id: providerMessageId,
    });
  } catch (sendError) {
    await markFailed(client, deliveryId, sendError);
  }
}
