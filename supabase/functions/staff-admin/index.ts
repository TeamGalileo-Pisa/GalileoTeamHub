import { requireActor } from "../_shared/actor.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/service-client.ts";

interface StaffRequest {
  action?: "create" | "update" | "reset_password" | "delete";
  id?: string;
  status?: "active" | "disabled";
  username?: string;
  displayName?: string;
  temporaryPassword?: string;
  isAdmin?: boolean;
  role?: "admin" | "team_leader" | "area_lead" | "member";
  areaId?: string;
}

function normalizeUsername(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== "POST") {
    return jsonResponse(request, { error: "METHOD_NOT_ALLOWED" }, 405);
  }

  let actor;
  try { actor = await requireActor(request); }
  catch (error) { return jsonResponse(request, { error: error instanceof Error ? error.message : "UNAUTHORIZED" }, 401); }
  const { user } = actor;
  const url = Deno.env.get("SUPABASE_URL")!;

  let body: StaffRequest;
  try {
    body = (await request.json()) as StaffRequest;
  } catch {
    return jsonResponse(request, { error: "INVALID_JSON" }, 400);
  }
  if (!body || typeof body !== "object")
    return jsonResponse(request, { error: "INVALID_STAFF_DATA" }, 400);
  const serviceClient = createServiceClient();
  const domain = Deno.env.get("AUTH_EMAIL_DOMAIN") ?? "auth.teamgalileo.local";
  if (!/^[a-z0-9.-]+$/i.test(domain))
    return jsonResponse(request, { error: "SERVER_NOT_CONFIGURED" }, 500);
  const action = body.action ?? "create";
  if (action !== "create") {
    if (
      !body.id ||
      !/^[0-9a-f-]{36}$/i.test(body.id) ||
      !["update", "reset_password", "delete"].includes(action)
    )
      return jsonResponse(request, { error: "INVALID_STAFF_DATA" }, 400);
    const { data: lease, error: leaseError } = await serviceClient.rpc(
      "acquire_staff_operation",
      { p_actor: user.id, p_user: body.id },
    );
    if (leaseError)
      return jsonResponse(request, { error: leaseError.message.includes("ACCOUNT_BUSY") ? "ACCOUNT_BUSY" : "STAFF_MIGRATION_REQUIRED" }, 409);
    try {
      const { data: old, error: oldError } = await serviceClient
        .from("profiles")
        .select("username,display_name,status")
        .eq("id", body.id)
        .single();
      const { data: oldAuth, error: authError } =
        await serviceClient.auth.admin.getUserById(body.id);
      if (oldError || authError || !oldAuth.user)
        throw new Error("ACCOUNT_UPDATE_FAILED");
      if (action === "reset_password") {
        const initialPassword = Deno.env.get("DEFAULT_INITIAL_PASSWORD");
        const suffix = Deno.env.get("DEFAULT_PASSWORD_SUFFIX");
        const resetPassword = body.temporaryPassword || initialPassword || (suffix ? old.username + suffix : "");
        if (resetPassword.length < 12 || !/[A-Z]/.test(resetPassword) || !/[a-z]/.test(resetPassword) || !/[0-9]/.test(resetPassword) || !/[^A-Za-z0-9]/.test(resetPassword)) throw new Error("INVALID_STAFF_PASSWORD");
        if (!resetPassword) throw new Error("DEFAULT_PASSWORD_NOT_CONFIGURED");
        // Only server memory: never return or log the derived password.
        const { error } = await serviceClient.auth.admin.updateUserById(
          body.id,
          {
            password: resetPassword,
            app_metadata: {
              ...oldAuth.user.app_metadata,
              password_reset_nonce: crypto.randomUUID(),
            },
          },
        );
        if (error) throw new Error("ACCOUNT_UPDATE_FAILED");
        await serviceClient
          .from("profiles")
          .update({ must_change_password: true })
          .eq("id", body.id);
        await serviceClient.from("audit_logs").insert({
          actor_user_id: user.id,
          actor_type: "staff",
          action: "staff.password_reset",
          entity_type: "profile",
          entity_id: body.id,
        });
      } else if (action === "delete") {
        const { error: prepareError } = await serviceClient.rpc(
          "prepare_staff_deletion",
          { p_id: body.id },
        );
        if (prepareError)
          throw new Error(
            prepareError.message.includes("LAST_ACTIVE_ADMIN")
              ? "LAST_ACTIVE_ADMIN"
              : "HAS_HISTORY",
          );
        const { error } = await serviceClient.auth.admin.deleteUser(body.id);
        if (error) throw new Error(error.message.includes("HAS_HISTORY") ? "HAS_HISTORY" : "ACCOUNT_UPDATE_FAILED");
        await serviceClient.from("audit_logs").insert({
          actor_user_id: user.id,
          actor_type: "staff",
          action: "staff.deleted",
          entity_type: "profile",
          entity_id: body.id,
        });
      } else {
        const proposed =
          typeof body.username === "string" ? body.username.trim() : "";
        if (
          !/^[A-Za-z0-9][A-Za-z0-9._-]{1,48}[A-Za-z0-9]$/.test(proposed) ||
          typeof body.displayName !== "string" ||
          typeof body.isAdmin !== "boolean" ||
          !["admin", "team_leader", "area_lead", "member"].includes(body.role ?? (body.isAdmin ? "admin" : "area_lead")) ||
          !["active", "disabled"].includes(body.status ?? "")
        )
          throw new Error("INVALID_STAFF_DATA");
        const { data: shared } = await serviceClient.from("area_shared_accounts").select("user_id").eq("user_id",body.id).maybeSingle();
        if (Boolean(shared) !== (body.role === "member")) throw new Error("INVALID_STAFF_DATA");
        const newEmail = normalizeUsername(proposed) + "@" + domain;
        const { error: renameError } =
          await serviceClient.auth.admin.updateUserById(body.id, {
            email: newEmail,
            email_confirm: true,
            user_metadata: {
              ...oldAuth.user.user_metadata,
              username: proposed,
              display_name: body.displayName.trim(),
            },
          });
        if (renameError) throw new Error("ACCOUNT_UPDATE_FAILED");
        const requestedRole = body.role ?? (body.isAdmin ? "admin" : "area_lead");
        const { error } = await serviceClient.rpc(requestedRole === "member" ? "update_shared_account" : "update_staff_profile_v2", {
          p_actor_id: user.id,
          p_id: body.id,
          p_username: proposed,
          p_display_name: body.displayName,
          ...(requestedRole === "member" ? {} : {p_role: requestedRole, p_area_id: requestedRole === "area_lead" ? body.areaId : null}),
          p_status: body.status,
        });
        if (error) {
          await serviceClient.auth.admin.updateUserById(body.id, {
            email: oldAuth.user.email,
            email_confirm: true,
            user_metadata: oldAuth.user.user_metadata,
          });
          throw new Error(
            error.message.includes("LAST_ACTIVE_ADMIN")
              ? "LAST_ACTIVE_ADMIN"
              : "ACCOUNT_UPDATE_FAILED",
          );
        }
        const { error: banError } =
          await serviceClient.auth.admin.updateUserById(body.id, {
            ban_duration: body.status === "disabled" ? "876000h" : "none",
          });
        if (banError) throw new Error("ACCOUNT_UPDATE_FAILED");
      }
      return jsonResponse(request, { ok: true });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "ACCOUNT_UPDATE_FAILED";
      const safe = [
        "LAST_ACTIVE_ADMIN",
        "HAS_HISTORY",
        "DEFAULT_PASSWORD_NOT_CONFIGURED",
        "INVALID_STAFF_PASSWORD",
        "INVALID_STAFF_DATA",
      ].includes(message)
        ? message
        : "ACCOUNT_UPDATE_FAILED";
      return jsonResponse(request, { error: safe }, 400);
    } finally {
      await serviceClient.rpc("release_staff_operation", {
        p_user: body.id,
        p_token: lease,
      });
    }
  }

  const requestedUsername =
    typeof body.username === "string" ? body.username.trim() : "";
  const username = normalizeUsername(requestedUsername);
  const displayName =
    typeof body.displayName === "string" ? body.displayName.trim() : "";
  const password =
    typeof body.temporaryPassword === "string" ? body.temporaryPassword : "";
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{1,48}[A-Za-z0-9]$/.test(requestedUsername) ||
    displayName.length < 2 ||
    displayName.length > 120 ||
    password.length < 12 ||
    !/[A-Z]/.test(password) ||
    !/[a-z]/.test(password) ||
    !/[0-9]/.test(password) ||
    !/[^A-Za-z0-9]/.test(password) ||
    ((body.role ?? (body.isAdmin ? "admin" : "area_lead")) === "area_lead" && !body.areaId)
  ) {
    return jsonResponse(request, { error: "INVALID_STAFF_DATA" }, 400);
  }

  const requestedRole = body.role ?? (body.isAdmin ? "admin" : "area_lead");
  if (!["admin", "team_leader", "area_lead"].includes(requestedRole))
    return jsonResponse(request, { error: "INVALID_STAFF_DATA" }, 400);
  if (requestedRole === "area_lead") {
    const { data: area } = await serviceClient
      .from("areas")
      .select("id")
      .eq("id", body.areaId)
      .eq("active", true)
      .maybeSingle();
    if (!area)
      return jsonResponse(request, { error: "INVALID_STAFF_DATA" }, 400);
  }
  const { data: created, error: createError } =
    await serviceClient.auth.admin.createUser({
      email: `${username}@${domain}`,
      password,
      email_confirm: true,
      user_metadata: { username, display_name: displayName },
    });

  if (createError || !created.user) {
    return jsonResponse(request, { error: "ACCOUNT_CREATION_FAILED" }, 409);
  }

  const createdUserId = created.user.id;
  try {
    const { error: profileError } = await serviceClient
      .from("profiles")
      .update({ username: body.username?.trim(), must_change_password: true })
      .eq("id", createdUserId);
    if (profileError) throw profileError;
    if (requestedRole === "admin" || requestedRole === "team_leader") {
      const { error } = await serviceClient.from("system_roles").insert({
        user_id: createdUserId,
        role: requestedRole,
        granted_by: user.id,
      });
      if (error) throw error;
    } else {
      const { error } = await serviceClient.from("area_memberships").insert({
        user_id: createdUserId,
        area_id: body.areaId,
        role: "area_lead",
        created_by: user.id,
      });
      if (error) throw error;
    }
  } catch {
    await serviceClient.auth.admin.deleteUser(createdUserId);
    return jsonResponse(request, { error: "ROLE_ASSIGNMENT_FAILED" }, 500);
  }

  return jsonResponse(
    request,
    { id: createdUserId, username, displayName },
    201,
  );
});
