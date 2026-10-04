import { requireActor } from "../_shared/actor.ts";
import { webPushConfig } from "../_shared/web-push-config.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== "POST") {
    return jsonResponse(request, { error: "METHOD_NOT_ALLOWED" }, 405);
  }
  try {
    const { client, user } = await requireActor(request, false);
    const raw = await request.text();
    if (raw.length > 6000) throw new Error("INVALID_DATA");
    const body = JSON.parse(raw);
    if (body.action === "config") {
      return jsonResponse(request, {
        publicKey: (await webPushConfig(client)).publicKey,
      });
    }
    if (body.action === "remove") {
      const { error } = await client.from("push_devices").delete().eq(
        "user_id",
        user.id,
      ).eq("address", body.address);
      if (error) throw error;
      return jsonResponse(request, { ok: true });
    }
    if (
      !["web", "android", "ios"].includes(body.platform) ||
      typeof body.address !== "string" || body.address.length > 2000
    ) throw new Error("INVALID_DATA");
    if (body.platform === "web") {
      if (body.deviceClass !== "mobile") throw new Error("INVALID_DATA");
      const u = new URL(body.address);
      if (
        u.protocol !== "https:" || u.username || u.password || u.port ||
        ![
            "fcm.googleapis.com",
            "updates.push.services.mozilla.com",
            "web.push.apple.com",
          ].includes(u.hostname) && !u.hostname.endsWith(".notify.windows.com")
      ) throw new Error("INVALID_DATA");
      if (
        body.subscription?.endpoint !== body.address ||
        !body.subscription?.keys?.p256dh || !body.subscription?.keys?.auth
      ) throw new Error("INVALID_DATA");
    } else if (
      body.platform === "ios" && !/^[a-f0-9]{64}$/i.test(body.address)
    ) throw new Error("INVALID_DATA");
    const { error: workerError } = await client.rpc("configure_email_worker", {
      p_url: Deno.env.get("SUPABASE_URL"),
    });
    if (workerError) throw workerError;
    const { error } = await client.from("push_devices").upsert({
      user_id: user.id,
      platform: body.platform,
      device_class: "mobile",
      address: body.address,
      subscription: body.platform === "web" ? body.subscription : null,
    }, { onConflict: "address" });
    if (error) throw error;
    return jsonResponse(request, { ok: true });
  } catch {
    return jsonResponse(request, { error: "PUSH_REGISTRATION_FAILED" }, 400);
  }
});
