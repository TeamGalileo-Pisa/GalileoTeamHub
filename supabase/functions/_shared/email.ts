import type { SupabaseClient } from "npm:@supabase/supabase-js@2.112.4";

import {
  emailCopy,
  OFFICIAL_EMAIL_FROM,
  type DeliveryPayload,
} from "./email-copy.ts";
export { OFFICIAL_EMAIL_FROM } from "./email-copy.ts";

interface GmailMessage {
  reconcileOnly?: boolean;
  to: string;
  subject: string;
  text: string;
  idempotencyId: string;
}

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
    signal: AbortSignal.timeout(8000),
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
    {
      signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!response.ok) throw new Error("GMAIL_LOOKUP_FAILED");

  const payload = (await response.json()) as {
    messages?: Array<{ id?: string }>;
  };
  return payload.messages?.[0]?.id ?? null;
}

export async function sendGmailMessage(message: GmailMessage): Promise<string> {
  const accessToken = await gmailAccessToken();
  const identity = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    {
      signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  const profile = identity.ok ? await identity.json() : null;
  if (profile?.emailAddress?.toLowerCase() !== "info.teamgalileo@gmail.com")
    throw new Error("GMAIL_WRONG_SENDER");
  const existingId = await findExistingMessage(
    accessToken,
    message.idempotencyId,
  );
  if (existingId) return existingId;
  if (message.reconcileOnly) throw new Error("GMAIL_SEND_UNCERTAIN");

  let response: Response;
  try {
    response = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        signal: AbortSignal.timeout(8000),
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: buildRawMessage(message) }),
      },
    );
  } catch {
    throw new Error("GMAIL_SEND_UNCERTAIN");
  }
  if (response.status >= 500) throw new Error("GMAIL_SEND_UNCERTAIN");
  if (!response.ok) throw new Error(`GMAIL_SEND_FAILED:${response.status}`);

  const payload = (await response.json().catch(() => {
    throw new Error("GMAIL_SEND_UNCERTAIN");
  })) as { id?: string };
  if (!payload.id) throw new Error("GMAIL_SEND_UNCERTAIN");
  return payload.id;
}

async function markFailed(
  client: SupabaseClient,
  deliveryId: string,
  error: unknown,
  attempt: number,
) {
  await client.rpc("mark_email_delivery_failed", {
    p_delivery_id: deliveryId,
    p_error: error instanceof Error ? error.message : "EMAIL_PROVIDER_ERROR",
    p_attempt: attempt,
  });
}

export async function sendQueuedEmail(
  client: SupabaseClient,
  deliveryId: string,
): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  if (url)
    await client.rpc("configure_email_worker", {
      p_url: url.replace(/\/$/, ""),
    });
  const { data, error } = await client.rpc("claim_email_delivery", {
    p_delivery_id: deliveryId,
  });
  if (error) throw error;
  if (!data) return;

  const payload = data as DeliveryPayload;
  const provider = Deno.env.get("EMAIL_PROVIDER");

  try {
    if (provider !== "gmail") throw new Error("EMAIL_NOT_CONFIGURED");

    const message = emailCopy(payload);
    const providerMessageId = await sendGmailMessage({
      to: payload.to_email,
      subject: message.subject,
      text: message.text,
      idempotencyId: payload.delivery_id,
      reconcileOnly: payload.reconcile_only,
    });
    const { error: markError } = await client.rpc("mark_email_delivery_sent", {
      p_delivery_id: deliveryId,
      p_provider_message_id: providerMessageId,
      p_attempt: payload.attempt_count,
    });
    if (markError) throw new Error("EMAIL_ACK_FAILED");
  } catch (sendError) {
    await markFailed(client, deliveryId, sendError, payload.attempt_count);
  }
}
