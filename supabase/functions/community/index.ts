import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/service-client.ts";
import { createSharedAccount } from "../_shared/shared-accounts.ts";
import { requireActor } from "../_shared/actor.ts";
import {
  applicationChoices,
  certifications,
  divisions,
  genericDivision,
} from "../_shared/application-fields.ts";

const validEmail = (s: unknown): s is string =>
  typeof s === "string" && s.length <= 254 &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const validText = (s: unknown, max = 4000): s is string =>
  typeof s === "string" && s.trim().length > 0 && s.length <= max;
const hash = async (token: string) =>
  "\\x" +
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
  ).map((b) => b.toString(16).padStart(2, "0")).join("");
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== "POST") {
    return jsonResponse(request, { error: "METHOD_NOT_ALLOWED" }, 405);
  }
  try {
    const raw = await request.text();
    if (raw.length > 24000) {
      return jsonResponse(request, { error: "INVALID_DATA" }, 413);
    }
    const body = JSON.parse(raw);
    const client = createServiceClient();
    const { error: workerError } = await client.rpc("configure_email_worker", {
      p_url: Deno.env.get("SUPABASE_URL"),
    });
    if (workerError) throw new Error("SERVER_NOT_CONFIGURED");
    if (body.action === "apply") {
      const a = body.answers;
      if (
        !validEmail(body.email) ||
        !body.email.toLowerCase().endsWith("@studenti.unipi.it") ||
        !validText(body.firstName, 100) || !validText(body.lastName, 100) ||
        !a || a.privacyAccepted !== true || !validText(a.degree, 200) ||
        !validText(a.motivation) || !validText(a.expectations)
      ) throw new Error("INVALID_DATA");
      for (const [key, choices] of Object.entries(applicationChoices)) {
        if (!choices.includes(a[key])) throw new Error("INVALID_DATA");
      }
      const { data: area } = await client.from("areas").select("slug").eq(
        "id",
        body.areaId,
      ).single();
      const division = divisions[area?.slug] ?? genericDivision;
      if (
        !division || !Array.isArray(a.skills) || !a.skills.length ||
        !a.skills.every((s: string) => division.skills.includes(s)) ||
        !Array.isArray(a.certifications) || !a.certifications.length ||
        !a.certifications.every((s: string) => certifications.includes(s))
      ) throw new Error("INVALID_DATA");
      const { error } = await client.rpc("submit_application", {
        p_area: body.areaId,
        p_email: body.email.toLowerCase().trim(),
        p_first: body.firstName.trim(),
        p_last: body.lastName.trim(),
        p_answers: a,
      });
      if (error) {
        throw new Error(
          error.code === "23505"
            ? "DUPLICATE_APPLICATION"
            : error.message.includes("APPLICATION_CLOSED")
            ? "APPLICATION_CLOSED"
            : "SAVE_FAILED",
        );
      }
      return jsonResponse(request, { ok: true });
    }
    if (body.action === "submit_membership") {
      if (
        typeof body.token !== "string" || !/^[a-f0-9]{64}$/.test(body.token) ||
        !body.data || body.data.confirmed !== "yes"
      ) throw new Error("INVALID_DATA");
      const data: Record<string, string> = {};
      for (
        const key of [
          "firstName",
          "lastName",
          "studentNumber",
          "degree",
          "department",
        ]
      ) {
        if (!validText(body.data[key], 180)) throw new Error("INVALID_DATA");
        data[key] = body.data[key].trim();
      }
      const { error } = await client.rpc("submit_membership", {
        p_token: body.token,
        p_data: data,
      });
      if (error) {
        throw new Error(
          error.message.includes("ALREADY_SUBMITTED")
            ? "ALREADY_SUBMITTED"
            : error.message.includes("INVALID_INVITATION")
            ? "INVALID_INVITATION"
            : "SAVE_FAILED",
        );
      }
      return jsonResponse(request, { ok: true });
    }
    if (body.action === "submit_member_adhesion") {
      const { user } = await requireActor(request, false);
      const data = body.data;
      if (!data || data.confirmed !== "yes" || !validEmail(data.email)) {
        throw new Error("INVALID_DATA");
      }
      for (const key of ["firstName", "lastName", "studentNumber", "degree", "department"]) {
        if (!validText(data[key], key === "studentNumber" ? 30 : 180)) throw new Error("INVALID_DATA");
      }
      const { error } = await client.rpc("submit_member_adhesion", {
        p_actor: user.id,
        p_data: {
          firstName: data.firstName.trim(),
          lastName: data.lastName.trim(),
          studentNumber: data.studentNumber.trim(),
          degree: data.degree.trim(),
          department: data.department.trim(),
          email: data.email.trim().toLowerCase(),
          confirmed: "yes",
        },
      });
      if (error) throw new Error(error.message.includes("INVALID_DATA") ? "INVALID_DATA" : error.message.includes("FORBIDDEN") ? "FORBIDDEN" : error.code === "23505" ? "ALREADY_SUBMITTED" : "SAVE_FAILED");
      return jsonResponse(request, { ok: true });
    }
    const { user } = await requireActor(request);
    if (body.action === "invite") {
      if (!validEmail(body.email)) throw new Error("INVALID_DATA");
      const { data: area } = await client.from("areas").select("id").eq(
        "id",
        body.areaId,
      ).eq("active", true).single();
      if (!area) throw new Error("INVALID_DATA");
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      const origin = Deno.env.get("PUBLIC_APP_URL") ?? "https://galileohub.info-teamgalileo.workers.dev";
      if (!origin || !origin.startsWith("https://")) {
        throw new Error("SERVER_NOT_CONFIGURED");
      }
      const { data: invitation, error } = await client.from(
        "membership_invitations",
      ).insert({
        email: body.email.trim().toLowerCase(),
        area_id: body.areaId,
        created_by: user.id,
        token_hash: await hash(token),
      }).select("id").single();
      if (error) throw new Error("SAVE_FAILED");
      const { error: mailError } = await client.from("community_outbox").insert(
        {
          kind: "invitation",
          recipient: body.email.trim().toLowerCase(),
          payload: { url: origin.replace(/\/$/, "") + "/adesione/" + token },
        },
      );
      if (mailError) {
        await client.from("membership_invitations").delete().eq(
          "id",
          invitation.id,
        );
        throw new Error("SAVE_FAILED");
      }
      return jsonResponse(request, { ok: true });
    }
    if (body.action === "create_member") {
      return jsonResponse(request, await createSharedAccount(client, body.areaId));
    }
    throw new Error("INVALID_DATA");
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVALID_DATA";
    const safe = [
        "UNAUTHORIZED",
        "FORBIDDEN",
        "INVALID_DATA",
        "APPLICATION_CLOSED",
        "DUPLICATE_APPLICATION",
        "INVALID_INVITATION",
        "ALREADY_SUBMITTED",
        "ACCOUNT_EXISTS",
        "SAVE_FAILED",
        "SERVER_NOT_CONFIGURED",
      ].includes(code)
      ? code
      : "SAVE_FAILED";
    return jsonResponse(
      request,
      { error: safe },
      safe === "UNAUTHORIZED" ? 401 : safe === "FORBIDDEN" ? 403 : 400,
    );
  }
});

