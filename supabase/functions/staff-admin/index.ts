import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/service-client.ts";

interface StaffRequest {
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

  let body: StaffRequest;
  try {
    body = (await request.json()) as StaffRequest;
  } catch {
    return jsonResponse(request, { error: "INVALID_JSON" }, 400);
  }

  const username = normalizeUsername(body.username ?? "");
  const displayName = body.displayName?.trim() ?? "";
  const password = body.temporaryPassword ?? "";
  if (
    !/^[a-z0-9][a-z0-9._-]{1,48}[a-z0-9]$/.test(username) ||
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

  const domain = Deno.env.get("AUTH_EMAIL_DOMAIN") ?? "";
  if (!domain) {
    return jsonResponse(request, { error: "SERVER_NOT_CONFIGURED" }, 500);
  }

  const serviceClient = createServiceClient();
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
