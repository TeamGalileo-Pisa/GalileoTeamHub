/// <reference path="../_shared/runtime.d.ts" />
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { sendQueuedEmail } from "../_shared/email.ts";
import { createServiceClient } from "../_shared/service-client.ts";
import {
  normalizeBookingFields,
  validateBookingFields,
} from "../_shared/booking-validation.ts";

interface BookingRequest {
  action?: "availability" | "book" | "manage" | "change" | "cancel";
  token?: string;
  slotId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  privacyAccepted?: boolean;
  privacyVersion?: number;
  manageToken?: string;
  newSlotId?: string;
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

function bookingErrorCode(message: string): string {
  const knownCodes = [
    "SLOT_UNAVAILABLE",
    "INVALID_STUDENT_EMAIL",
    "INVALID_BOOKING_LINK",
    "INVALID_CANDIDATE_NAME",
    "INVALID_EMAIL",
    "PRIVACY_CONSENT_REQUIRED",
    "PRIVACY_VERSION_OUTDATED",
    "PRIVACY_NOT_CONFIGURED",
    "BOOKING_REQUIRES_24_HOURS",
    "CANDIDATE_ALREADY_BOOKED",
    "INVALID_MANAGE_TOKEN",
    "BOOKING_NOT_FOUND",
    "SLOT_UNAVAILABLE_OR_LESS_THAN_24H",
  ];

  return knownCodes.find((code) => message.includes(code)) ?? "BOOKING_FAILED";
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

  if (body.action === "manage") {
    if (typeof body.manageToken !== "string" || body.manageToken.length !== 64)
      return jsonResponse(request, { error: "INVALID_MANAGE_TOKEN" }, 404);
    const [bookingResult, slotsResult] = await Promise.all([
      client.rpc("get_booking_by_manage_token", { p_token: body.manageToken }),
      client.rpc("list_booking_change_slots", { p_token: body.manageToken }),
    ]);
    if (bookingResult.error || slotsResult.error || !bookingResult.data)
      return jsonResponse(request, { error: "INVALID_MANAGE_TOKEN" }, 404);
    return jsonResponse(request, { booking: bookingResult.data, slots: slotsResult.data ?? [] });
  }

  if (body.action === "change") {
    if (typeof body.manageToken !== "string" || typeof body.newSlotId !== "string")
      return jsonResponse(request, { error: "INVALID_MANAGE_TOKEN" }, 400);
    const { data, error } = await client.rpc("change_booking_by_manage_token", {
      p_token: body.manageToken,
      p_new_slot_id: body.newSlotId,
    });
    if (error) {
      const code = bookingErrorCode(error.message);
      return jsonResponse(request, { error: code }, code === "SLOT_UNAVAILABLE" ? 409 : 400);
    }
    return jsonResponse(request, { booking: data });
  }

  if (body.action === "cancel") {
    if (typeof body.manageToken !== "string")
      return jsonResponse(request, { error: "INVALID_MANAGE_TOKEN" }, 400);
    const { error } = await client.rpc("cancel_booking_by_manage_token", { p_token: body.manageToken });
    if (error) {
      const code = bookingErrorCode(error.message);
      return jsonResponse(request, { error: code }, 400);
    }
    return jsonResponse(request, { ok: true });
  }

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
    if (validationError) {
      return jsonResponse(request, { error: validationError }, 400);
    }

    if (
      body.privacyAccepted !== true ||
      typeof body.privacyVersion !== "number" ||
      !Number.isSafeInteger(body.privacyVersion) ||
      body.privacyVersion < 1
    ) {
      return jsonResponse(request, { error: "PRIVACY_CONSENT_REQUIRED" }, 400);
    }

    const { data, error } = await client.rpc("book_public_slot", {
      p_token: body.token,
      p_slot_id: fields.slotId,
      p_first_name: fields.firstName,
      p_last_name: fields.lastName,
      p_email: fields.email,
      p_privacy_accepted: true,
      p_privacy_version: body.privacyVersion,
    });

    if (error) {
      const code = bookingErrorCode(error.message);
      return jsonResponse(
        request,
        { error: code },
        code === "SLOT_UNAVAILABLE"
          ? 409
          : code === "INVALID_BOOKING_LINK"
            ? 404
            : 400,
      );
    }

    const result = data as Record<string, unknown>;
    if (typeof result.delivery_id === "string") {
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
