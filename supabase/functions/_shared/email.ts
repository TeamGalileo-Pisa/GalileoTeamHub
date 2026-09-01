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

const OFFICIAL_EMAIL_FROM =
  "Team Galileo Pisa <info.teamgalileo@gmail.com>";

const formatter = new Intl.DateTimeFormat("it-IT", {
  timeZone: "Europe/Rome",
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

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
      headingByKind[payload.kind] + ".",
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

    if (provider !== "resend") {
      throw new Error("Unsupported email provider");
    }

    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) throw new Error("Missing email provider configuration");

    const message = emailCopy(payload);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": deliveryId,
      },
      body: JSON.stringify({
        from: OFFICIAL_EMAIL_FROM,
        to: [payload.to_email],
        subject: message.subject,
        text: message.text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Email provider returned ${response.status}`);
    }

    const result = (await response.json()) as { id?: string };
    await client.rpc("mark_email_delivery_sent", {
      p_delivery_id: deliveryId,
      p_provider_message_id: result.id ?? "resend:accepted",
    });
  } catch (error) {
    await markFailed(client, deliveryId, error);
  }
}

