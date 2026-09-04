import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { sendGmailMessage } from "../_shared/email.ts";
import { createServiceClient } from "../_shared/service-client.ts";

interface TestEmailRequest {
  toEmail?: string;
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
  const { data: profile } = await userClient
    .from("profiles")
    .select("status,must_change_password")
    .eq("id", user.id)
    .single();
  if (profile?.status !== "active" || profile.must_change_password)
    return jsonResponse(request, { error: "FORBIDDEN" }, 403);

  let body: TestEmailRequest;
  try {
    body = (await request.json()) as TestEmailRequest;
  } catch {
    return jsonResponse(request, { error: "INVALID_JSON" }, 400);
  }

  const toEmail =
    typeof body?.toEmail === "string" ? body.toEmail.trim().toLowerCase() : "";
  if (toEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
    return jsonResponse(request, { error: "INVALID_EMAIL" }, 400);
  }
  if ((Deno.env.get("EMAIL_PROVIDER") ?? "development") !== "gmail") {
    return jsonResponse(request, { error: "EMAIL_NOT_CONFIGURED" }, 503);
  }

  try {
    const client = createServiceClient();
    const { error: setupError } = await client.rpc("configure_email_worker", {
      p_url: url.replace(/\/$/, ""),
    });
    if (setupError) throw new Error("WORKER_SETUP_FAILED");
    const providerMessageId = await sendGmailMessage({
      to: toEmail,
      subject: "Email di prova · Gestionale Colloqui Team Galileo",
      text: [
        "Questa è un'email di prova inviata dal Gestionale Colloqui.",
        "",
        "Se la stai leggendo, la configurazione Gmail API è attiva.",
        "",
        "Team Galileo Pisa",
      ].join("\n"),
      idempotencyId: `admin-test-${crypto.randomUUID()}`,
    });
    return jsonResponse(request, { ok: true, providerMessageId });
  } catch {
    return jsonResponse(request, { error: "TEST_EMAIL_FAILED" }, 502);
  }
});
