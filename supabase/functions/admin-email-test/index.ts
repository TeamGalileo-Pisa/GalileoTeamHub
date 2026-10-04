import { requireActor } from "../_shared/actor.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { checkGmailConfiguration, sendGmailMessage } from "../_shared/email.ts";
import { createServiceClient } from "../_shared/service-client.ts";

interface TestEmailRequest {
  action?: "check" | "send";
  toEmail?: string;
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

  let body: TestEmailRequest;
  try {
    body = (await request.json()) as TestEmailRequest;
  } catch {
    return jsonResponse(request, { error: "INVALID_JSON" }, 400);
  }

  const action = body?.action === "check" ? "check" : "send";

  if ((Deno.env.get("EMAIL_PROVIDER") ?? "development") !== "gmail") {
    return jsonResponse(request, { error: "EMAIL_NOT_CONFIGURED" }, 503);
  }

  if (action === "check") {
    try {
      const diagnostic = await checkGmailConfiguration();
      return jsonResponse(request, diagnostic);
    } catch (error) {
      const message = error instanceof Error ? error.message : "TEST_EMAIL_FAILED";
      const safe = /^(EMAIL_NOT_CONFIGURED|GMAIL_OAUTH_FAILED:[A-Za-z0-9_]+|GMAIL_WRONG_SENDER|GMAIL_SCOPE_REQUIRED|GMAIL_LOOKUP_FAILED)$/.test(message)
        ? message
        : "TEST_EMAIL_FAILED";
      return jsonResponse(request, { error: safe }, 502);
    }
  }

  const toEmail =
    typeof body?.toEmail === "string" ? body.toEmail.trim().toLowerCase() : "";
  if (toEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
    return jsonResponse(request, { error: "INVALID_EMAIL" }, 400);
  }

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
  } catch (error) {
    const message = error instanceof Error ? error.message : "TEST_EMAIL_FAILED";
    const safe = /^(EMAIL_NOT_CONFIGURED|GMAIL_OAUTH_FAILED:[A-Za-z0-9_]+|GMAIL_WRONG_SENDER|GMAIL_SCOPE_REQUIRED|GMAIL_LOOKUP_FAILED|GMAIL_SEND_FAILED:\d{3}|GMAIL_SEND_UNCERTAIN)$/.test(message)
      ? message
      : "TEST_EMAIL_FAILED";
    return jsonResponse(request, { error: safe }, 502);
  }
});
