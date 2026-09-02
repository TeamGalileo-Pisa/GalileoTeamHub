/// <reference path="../_shared/runtime.d.ts" />
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { sendQueuedEmail } from "../_shared/email.ts";
import { createServiceClient } from "../_shared/service-client.ts";
import {
  normalizeBookingFields,
  validateBookingFields,
} from "../_shared/booking-validation.ts";

interface BookingRequest {
  action?: "availability" | "book";
  token?: string;
  slotId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

function snakeToCamelAvailability(data: Record<string, unknown>) {
  const slots = Array.isArray(data.slots) ? data.slots : [];
  return {
    areaName: data.area_name,
    sessionName: data.session_name,
    slots: slots.map((slot) => {
      const row = slot as Record<string, unknown>;
      return {
        id: row.id,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        roomName: row.room_name,
      };
    }),
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (request.method !== "POST") {
    return jsonResponse(request, { error: "METHOD_NOT_ALLOWED" }, 405);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 12_000) {
    return jsonResponse(request, { error: "PAYLOAD_TOO_LARGE" }, 413);
  }

  let body: BookingRequest;
  try {
    body = (await request.json()) as BookingRequest;
  } catch {
    return jsonResponse(request, { error: "INVALID_JSON" }, 400);
  }

  if (
    !body ||
    typeof body.token !== "string" ||
    !body.token ||
    body.token.length > 140
  ) {
    return jsonResponse(request, { error: "INVALID_BOOKING_LINK" }, 404);
  }

  const client = createServiceClient();

  if (body.action === "availability") {
    const { data, error } = await client.rpc(
      "get_public_booking_availability",
      { p_token: body.token },
    );
    if (error || !data) {
      return jsonResponse(request, { error: "INVALID_BOOKING_LINK" }, 404);
    }
    return jsonResponse(
      request,
      snakeToCamelAvailability(data as Record<string, unknown>),
    );
  }

  if (body.action === "book") {
    const fields = normalizeBookingFields(body as Record<string, unknown>);
    const validationError = validateBookingFields(
      body as Record<string, unknown>,
    );
    if (validationError)
      return jsonResponse(request, { error: validationError }, 400);

    const { data, error } = await client.rpc("book_public_slot", {
      p_token: body.token,
      p_slot_id: fields.slotId,
      p_first_name: fields.firstName,
      p_last_name: fields.lastName,
      p_email: fields.email,
    });

    if (error) {
      const isConflict = error.message.includes("SLOT_UNAVAILABLE");
      return jsonResponse(
        request,
        {
          error: isConflict
            ? "SLOT_UNAVAILABLE"
            : error.message.includes("INVALID_STUDENT_EMAIL")
              ? "INVALID_STUDENT_EMAIL"
              : "BOOKING_FAILED",
        },
        isConflict ? 409 : 400,
      );
    }

    const result = data as Record<string, unknown>;
    if (typeof result.delivery_id === "string") {
      // The booking transaction is already committed. The durable cron worker
      // retries even if this isolate is terminated before delivery completes.
      EdgeRuntime.waitUntil(
        sendQueuedEmail(client, result.delivery_id).catch(() => undefined),
      );
    }

    return jsonResponse(
      request,
      {
        bookingId: result.booking_id,
        candidateName: result.candidate_name,
        areaName: result.area_name,
        roomName: result.room_name,
        startsAt: result.starts_at,
        endsAt: result.ends_at,
      },
      201,
    );
  }

  return jsonResponse(request, { error: "UNKNOWN_ACTION" }, 400);
});
