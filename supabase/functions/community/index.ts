import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/service-client.ts";
import { createSharedAccount } from "../_shared/shared-accounts.ts";
import { membershipExcel, type MembershipExportRow } from "../_shared/membership-excel.ts";
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
const membershipAreas = [
  "Mobility Division", "Manipulation Division", "Electronics, RF & Power Supply Division",
  "Software, Nav & Controls Division", "Geology Division", "Life Detection Division",
  "Business Area", "Marketing & Comm. Area", "Logistics Area", "Direzione tecnica/Responsabile",
];
const membershipLeadershipRoles = [
  "Team Leader", "Engineering Director", "Science Director", "Head of Mobility Division",
  "Head of Manipulation Division", "Head of Electronics, RF & Power Supply Division",
  "Head of Software, Nav & Controls Division", "Head of Geology Division",
  "Head of Life Detection Division", "Head of Business Area", "Head of Marketing & Comm. Area",
  "Head of Logistics Area",
];
const membershipLimits: Record<string, number> = {
  firstName: 100, lastName: 100, degree: 180, department: 180, studentNumber: 30,
  area: 80, leadershipRole: 100, commitmentsAccepted: 3, internalRegulationAccepted: 3,
  ipAccepted: 3, selfCertificationAccepted: 3, gdprAccepted: 3, mediaAccepted: 3,
  institutionalEmail: 254, phone: 40, linkedin: 500, privacyAccepted: 3,
};
function membershipAnswers(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_DATA");
  const source = value as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const [key, limit] of Object.entries(membershipLimits)) {
    if (!(key in source)) continue;
    if (typeof source[key] !== "string" || source[key].length > limit) throw new Error("INVALID_DATA");
    result[key] = source[key] as string;
  }
  if (result.area && !membershipAreas.includes(result.area)) throw new Error("INVALID_DATA");
  if (result.leadershipRole && !membershipLeadershipRoles.includes(result.leadershipRole)) throw new Error("INVALID_DATA");
  if (result.area !== "Direzione tecnica/Responsabile") delete result.leadershipRole;
  if (result.institutionalEmail && (!validEmail(result.institutionalEmail) || !result.institutionalEmail.toLowerCase().endsWith("@studenti.unipi.it"))) throw new Error("INVALID_DATA");
  if (result.linkedin && !/^https:\/\//i.test(result.linkedin)) throw new Error("INVALID_DATA");
  for (const key of ["commitmentsAccepted", "internalRegulationAccepted", "ipAccepted", "selfCertificationAccepted", "gdprAccepted", "mediaAccepted", "privacyAccepted"]) {
    if (key in result && result[key] !== "" && result[key] !== "yes") throw new Error("INVALID_DATA");
  }
  return result;
}
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
    if (body.action === "get_membership_form_link") {
      const { user } = await requireActor(request);
      const origin = Deno.env.get("PUBLIC_APP_URL") ??
        "https://galileohub.info-teamgalileo.workers.dev";
      if (!origin.startsWith("https://")) {
        throw new Error("SERVER_NOT_CONFIGURED");
      }
      const { data: token, error } = await client.rpc(
        "get_or_create_membership_form_link",
        { p_actor: user.id },
      );
      if (error || typeof token !== "string") throw new Error("SAVE_FAILED");
      return jsonResponse(request, {
        url: origin.replace(/\/$/, "") + "/adesione/" + token,
      });
    }
    if (body.action === "get_membership_public_link") {
      const { client: actorClient, user } = await requireActor(request, false);
      const [{ data: roles }, { data: memberAccount }] = await Promise.all([
        actorClient.from("system_roles").select("role").eq("user_id", user.id)
          .in("role", ["admin", "team_leader"]),
        actorClient.from("area_shared_accounts").select("area_id")
          .eq("user_id", user.id).maybeSingle(),
      ]);
      if (!roles?.length && !memberAccount) throw new Error("FORBIDDEN");
      const { data: link, error } = await client.from("membership_form_links")
        .select("public_token").is("revoked_at", null).maybeSingle();
      if (error) throw new Error("SAVE_FAILED");
      if (!link?.public_token) throw new Error("FORM_NOT_READY");
      const origin = Deno.env.get("PUBLIC_APP_URL") ??
        "https://galileohub.info-teamgalileo.workers.dev";
      if (!origin.startsWith("https://")) {
        throw new Error("SERVER_NOT_CONFIGURED");
      }
      return jsonResponse(request, {
        url: origin.replace(/\/$/, "") + "/adesione/" + link.public_token,
      });
    }
    if (
      body.action === "get_membership_shared_draft" ||
      body.action === "save_membership_shared_draft" ||
      body.action === "submit_membership_shared_form"
    ) {
      if (
        typeof body.token !== "string" || !/^[a-f0-9]{64}$/.test(body.token) ||
        typeof body.draftId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.draftId)
      ) throw new Error("INVALID_INVITATION");
      const args = { p_token: body.token, p_draft_id: body.draftId };
      if (body.action === "get_membership_shared_draft") {
        const { data, error } = await client.rpc(
          "get_membership_shared_draft",
          args,
        );
        if (error) throw new Error("SAVE_FAILED");
        if (data !== null) return jsonResponse(request, data);
        const { data: legacyData, error: legacyError } = await client.rpc(
          "get_membership_draft",
          { p_token: body.token },
        );
        if (legacyError) throw new Error("INVALID_INVITATION");
        return jsonResponse(request, legacyData);
      }
      const data = membershipAnswers(body.data);
      const rpc = body.action === "submit_membership_shared_form"
        ? "submit_membership_shared_form"
        : "save_membership_shared_draft";
      const { data: saved, error } = await client.rpc(rpc, {
        ...args,
        p_data: data,
      });
      if (error) throw new Error(error.message.includes("INVALID_DATA")
        ? "INVALID_DATA"
        : error.message.includes("DUPLICATE_MEMBERSHIP")
        ? "DUPLICATE_MEMBERSHIP"
        : "SAVE_FAILED");
      if (saved === true) return jsonResponse(request, { ok: true });
      const legacyRpc = body.action === "submit_membership_shared_form"
        ? "submit_membership"
        : "save_membership_draft";
      const { error: legacyError } = await client.rpc(legacyRpc, {
        p_token: body.token,
        p_data: data,
      });
      if (legacyError) {
        throw new Error(legacyError.message.includes("ALREADY_SUBMITTED")
          ? "ALREADY_SUBMITTED"
          : legacyError.message.includes("INVALID_INVITATION")
          ? "INVALID_INVITATION"
          : legacyError.message.includes("INVALID_DATA")
          ? "INVALID_DATA"
          : "SAVE_FAILED");
      }
      return jsonResponse(request, { ok: true });
    }
    if (body.action === "get_membership_draft" || body.action === "save_membership_draft" || body.action === "submit_membership") {
      if (typeof body.token !== "string" || !/^[a-f0-9]{64}$/.test(body.token)) throw new Error("INVALID_INVITATION");
      if (body.action === "get_membership_draft") {
        const { data, error } = await client.rpc("get_membership_draft", { p_token: body.token });
        if (error) throw new Error(error.message.includes("INVALID_INVITATION") ? "INVALID_INVITATION" : "SAVE_FAILED");
        return jsonResponse(request, data);
      }
      const data = membershipAnswers(body.data);
      const rpc = body.action === "submit_membership" ? "submit_membership" : "save_membership_draft";
      const { error } = await client.rpc(rpc, { p_token: body.token, p_data: data });
      if (error) throw new Error(error.message.includes("ALREADY_SUBMITTED") ? "ALREADY_SUBMITTED" : error.message.includes("INVALID_INVITATION") ? "INVALID_INVITATION" : error.message.includes("INVALID_DATA") ? "INVALID_DATA" : "SAVE_FAILED");
      return jsonResponse(request, { ok: true });
    }
    if (body.action === "get_member_adhesion_draft" || body.action === "save_member_adhesion_draft" || body.action === "submit_member_adhesion") {
      const { user } = await requireActor(request, false);
      if (typeof body.draftId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.draftId)) throw new Error("INVALID_DATA");
      if (body.action === "get_member_adhesion_draft") {
        const { data, error } = await client.rpc("get_member_adhesion_draft", { p_actor: user.id, p_draft_id: body.draftId });
        if (error) throw new Error(error.message.includes("FORBIDDEN") ? "FORBIDDEN" : "SAVE_FAILED");
        return jsonResponse(request, data);
      }
      const data = membershipAnswers(body.data);
      const rpc = body.action === "submit_member_adhesion" ? "submit_member_adhesion" : "save_member_adhesion_draft";
      const { error } = await client.rpc(rpc, { p_actor: user.id, p_draft_id: body.draftId, p_data: data });
      if (error) throw new Error(error.message.includes("INVALID_DATA") ? "INVALID_DATA" : error.message.includes("FORBIDDEN") ? "FORBIDDEN" : error.message.includes("ALREADY_SUBMITTED") ? "ALREADY_SUBMITTED" : "SAVE_FAILED");
      return jsonResponse(request, { ok: true });
    }
    if (body.action === "export_membership_excel") {
      const { client: adminClient } = await requireActor(request);
      const areaMap = new Map<string, string>();
      const { data: areaRows, error: areaError } = await adminClient.from("areas").select("id,name");
      if (areaError) throw new Error("SAVE_FAILED");
      for (const area of areaRows ?? []) areaMap.set(area.id, area.name);
      const rows: MembershipExportRow[] = [];
      const { data: sharedRows, error: sharedError } = await adminClient
        .from("membership_form_responses")
        .select("status,data,created_at,updated_at,submitted_at")
        .order("created_at", { ascending: true });
      if (sharedError) throw new Error("SAVE_FAILED");
      for (const row of sharedRows ?? []) rows.push({
        status: row.status,
        assignedArea: typeof row.data?.area === "string" ? row.data.area : "",
        answers: (row.data && typeof row.data === "object" ? row.data : {}) as Record<string, unknown>,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        submittedAt: row.submitted_at,
      });
      const pageSize = 1000;
      for (let offset = 0; offset < 100000; offset += pageSize) {
        const { data, error } = await adminClient.from("member_adhesions")
          .select("status,area_id,answers,created_at,updated_at,submitted_at")
          .order("created_at", { ascending: true }).range(offset, offset + pageSize - 1);
        if (error) throw new Error("SAVE_FAILED");
        for (const row of data ?? []) rows.push({
          status: row.status,
          assignedArea: areaMap.get(row.area_id) ?? "",
          answers: (row.answers && typeof row.answers === "object" ? row.answers : {}) as Record<string, unknown>,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          submittedAt: row.submitted_at,
        });
        if (!data || data.length < pageSize) break;
        if (offset + pageSize >= 100000) throw new Error("SAVE_FAILED");
      }
      const bytes = membershipExcel(rows);
      return new Response(bytes, { status: 200, headers: {
        ...corsHeaders(request),
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="adesioni-team-galileo.xlsx"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      }});
    }
    if (body.action === "list_applications") {
      const { user } = await requireActor(request, false);
      const [{ data: roles, error: rolesError }, { data: memberships, error: membershipsError }] = await Promise.all([
        client.from("system_roles").select("role").eq("user_id", user.id)
          .in("role", ["admin", "team_leader"]),
        client.from("area_memberships").select("area_id").eq("user_id", user.id)
          .eq("role", "area_lead").is("ended_at", null),
      ]);
      if (rolesError || membershipsError) throw new Error("SAVE_FAILED");
      const leadAreaIds = (memberships ?? []).map((membership) => membership.area_id);
      const [{ data: leadAreas, error: leadAreaError }, { data: allAreas, error: allAreaError }] = await Promise.all([
        leadAreaIds.length
          ? client.from("areas").select("id,slug").in("id", leadAreaIds)
          : Promise.resolve({ data: [], error: null }),
        client.from("areas").select("id,name"),
      ]);
      if (leadAreaError || allAreaError) throw new Error("SAVE_FAILED");
      const isAdmin = (roles ?? []).length > 0;
      const isLogistics = (leadAreas ?? []).some((area) => area.slug === "logistica");
      if (!isAdmin && !isLogistics && leadAreaIds.length === 0) throw new Error("FORBIDDEN");
      let applicationQuery = client.from("applications")
        .select("id,area_id,email,first_name,last_name,answers,created_at")
        .order("created_at", { ascending: false }).limit(500);
      if (!isAdmin && !isLogistics) applicationQuery = applicationQuery.in("area_id", leadAreaIds);
      const { data: applications, error: applicationError } = await applicationQuery;
      if (applicationError) throw new Error("SAVE_FAILED");
      const names = new Map((allAreas ?? []).map((area) => [area.id, area.name]));
      return jsonResponse(request, (applications ?? []).map((application) => ({
        ...application,
        area_name: names.get(application.area_id) ?? "Area",
      })));
    }
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
        "DUPLICATE_MEMBERSHIP",
        "FORM_NOT_READY",
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

