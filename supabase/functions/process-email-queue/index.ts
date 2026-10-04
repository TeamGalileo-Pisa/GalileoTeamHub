/// <reference path="../_shared/runtime.d.ts" />
import { createServiceClient } from "../_shared/service-client.ts";
import { processPush } from "../_shared/push-worker.ts";
import { processCommunityMail } from "../_shared/community-mail.ts";
import { sendQueuedEmail, checkGmailConfiguration } from "../_shared/email.ts";
import { createSharedAccount } from "../_shared/shared-accounts.ts";
import { divisions } from "../../../src/lib/application-fields.ts";
import { webPushConfig } from "../_shared/web-push-config.ts";

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const token = request.headers.get("x-queue-token");
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    return new Response(null, { status: 401 });
  const client = createServiceClient();
  const { data: authorized, error } = await client.rpc(
    "verify_email_worker_token",
    { p_token: token },
  );
  if (error || authorized !== true) return new Response(null, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const reply = (value: unknown) => Response.json(value, { headers: { "Cache-Control": "no-store" } });
  if (body.action === "diagnostics") {
    let gmail;
    try { gmail = await checkGmailConfiguration(); }
    catch (e) { gmail = { error: e instanceof Error && /^[A-Z_]+(:[a-z0-9_]+)?$/.test(e.message) ? e.message : "EMAIL_PROVIDER_ERROR" }; }
    let webPush = false;
    try { webPush = Boolean((await webPushConfig(client)).publicKey); } catch { /* reported below */ }
    return reply({ gmail, webPush, configured: Object.fromEntries([
      "PUBLIC_APP_URL", "APP_ORIGINS", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY",
      "FIREBASE_SERVICE_ACCOUNT", "APNS_PRIVATE_KEY", "APNS_KEY_ID", "APNS_TEAM_ID", "APNS_BUNDLE_ID",
    ].map(key => [key, Boolean(Deno.env.get(key))])) });
  }
  // Explicit service operation, never executed by the ordinary cron request.
  // Existing accounts/passwords are left intact. The queue token stays in Vault.
  if (body.action === "provision_members") {
    const { data: areas, error: areaError } = await client.from("areas")
      .select("id,slug").eq("active", true).in("slug", Object.keys(divisions));
    if (areaError) return new Response(null, { status: 503 });
    const accounts = [];
    for (const area of areas ?? []) {
      try { accounts.push(await createSharedAccount(client, area.id)); }
      catch (e) { accounts.push({ username: "membri." + area.slug, error: e instanceof Error ? e.message : "SAVE_FAILED" }); }
    }
    return reply({ accounts });
  }
  if (body.action) return new Response(null, { status: 400 });
  const { data: ids, error: queueError } = await client.rpc(
    "list_due_email_deliveries",
  );
  if (queueError) return new Response(null, { status: 503 });
  EdgeRuntime.waitUntil(
    Promise.allSettled(
      [...((ids as string[]) ?? []).map((id) => sendQueuedEmail(client, id)), processCommunityMail(client), processPush(client)],
    ).then(() => undefined),
  );
  return new Response(null, { status: 202 });
});
