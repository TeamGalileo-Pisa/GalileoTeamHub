import { createClient } from "npm:@supabase/supabase-js@2.112.4";
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

  const authorization = request.headers.get("authorization");
  const url = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!authorization || !url || !publishableKey) {
    return jsonResponse(request, { error: "UNAUTHORIZED" }, 401);
  }

  const userClient = createClient(url, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();
  if (userError || !user) {
    return jsonResponse(request, { error: "UNAUTHORIZED" }, 401);
  }

  const { data: adminRole } = await userClient
    .from("system_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!adminRole) {
    return jsonResponse(request, { error: "FORBIDDEN" }, 403);
  }
  const { data: actorProfile } = await userClient
    .from("profiles")
    .select("status,must_change_password")
    .eq("id", user.id)
    .single();
  if (actorProfile?.status !== "active" || actorProfile.must_change_password)
    return jsonResponse(request, { error: "FORBIDDEN" }, 403);

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
      return jsonResponse(request, { error: "ACCOUNT_BUSY" }, 409);
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
        const suffix = Deno.env.get("DEFAULT_PASSWORD_SUFFIX");
        if (!suffix) throw new Error("DEFAULT_PASSWORD_NOT_CONFIGURED");
        // Only server memory: never return or log the derived password.
        const { error: flagError } = await serviceClient
          .from("profiles")
          .update({ must_change_password: true })
          .eq("id", body.id);
        if (flagError) throw new Error("ACCOUNT_UPDATE_FAILED");
        const { error } = await serviceClient.auth.admin.updateUserById(
          body.id,
          {
            password: old.username + suffix,
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
        const { error: guard } = await serviceClient.rpc(
          "check_staff_deletion",
          { p_id: body.id },
        );
        if (guard)
          throw new Error(
            guard.message.includes("LAST_ACTIVE_ADMIN")
              ? "LAST_ACTIVE_ADMIN"
              : "HAS_HISTORY",
          );
        const { error } = await serviceClient.auth.admin.deleteUser(body.id);
        if (error) throw new Error("HAS_HISTORY");
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
          !["active", "disabled"].includes(body.status ?? "")
        )
          throw new Error("INVALID_STAFF_DATA");
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
        const { error } = await serviceClient.rpc("update_staff_profile", {
          p_actor_id: user.id,
          p_id: body.id,
          p_username: proposed,
          p_display_name: body.displayName,
          p_is_admin: body.isAdmin,
          p_area_id: body.isAdmin ? null : body.areaId,
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
    (!body.isAdmin && !body.areaId)
  ) {
    return jsonResponse(request, { error: "INVALID_STAFF_DATA" }, 400);
  }

  if (typeof body.isAdmin !== "boolean")
    return jsonResponse(request, { error: "INVALID_STAFF_DATA" }, 400);
  if (!body.isAdmin) {
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
    if (body.isAdmin) {
      const { error } = await serviceClient.from("system_roles").insert({
        user_id: createdUserId,
        role: "admin",
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
