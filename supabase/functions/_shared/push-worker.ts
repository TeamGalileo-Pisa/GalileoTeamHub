import webpush from "npm:web-push@3.6.7";
import { webPushConfig } from "./web-push-config.ts";
import { importPKCS8, SignJWT } from "npm:jose@6.1.3";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.112.4";
async function nativeSend(
  platform: string,
  address: string,
  payload: { title: string; body: string; id: string; url: string },
) {
  if (platform === "android") {
    const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
    if (!raw) throw new Error("FCM_NOT_CONFIGURED");
    const account = JSON.parse(raw);
    const signed = await new SignJWT({
      scope: "https://www.googleapis.com/auth/firebase.messaging",
    }).setProtectedHeader({ alg: "RS256" }).setIssuer(account.client_email)
      .setAudience("https://oauth2.googleapis.com/token").setIssuedAt()
      .setExpirationTime("1h").sign(
        await importPKCS8(account.private_key, "RS256"),
      );
    const auth = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: signed,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!auth.ok) throw new Error("FCM_AUTH_FAILED");
    const { access_token } = await auth.json();
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: address,
            notification: { title: payload.title, body: payload.body },
            data: { url: payload.url, notificationId: payload.id },
            android: { notification: { tag: payload.id } },
          },
        }),
        signal: AbortSignal.timeout(8000),
      },
    );
    return response;
  }
  const privateKey = Deno.env.get("APNS_PRIVATE_KEY");
  const keyId = Deno.env.get("APNS_KEY_ID");
  const teamId = Deno.env.get("APNS_TEAM_ID");
  const topic = Deno.env.get("APNS_BUNDLE_ID");
  if (!privateKey || !keyId || !teamId || !topic) {
    throw new Error("APNS_NOT_CONFIGURED");
  }
  const jwt = await new SignJWT({}).setProtectedHeader({
    alg: "ES256",
    kid: keyId,
  }).setIssuer(teamId).setIssuedAt().sign(
    await importPKCS8(privateKey.replaceAll("\\n", "\n"), "ES256"),
  );
  const host = Deno.env.get("APNS_ENVIRONMENT") === "sandbox"
    ? "api.sandbox.push.apple.com"
    : "api.push.apple.com";
  return fetch(`https://${host}/3/device/${address}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-topic": topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-collapse-id": payload.id,
    },
    body: JSON.stringify({
      aps: {
        alert: { title: payload.title, body: payload.body },
        sound: "default",
      },
      url: payload.url,
    }),
    signal: AbortSignal.timeout(8000),
  });
}
export async function processPush(client: SupabaseClient) {
  const { data: jobs, error } = await client.rpc("claim_push_jobs");
  if (error) throw error;
  for (const job of jobs ?? []) {
    try {
      const { data: device } = await client.from("push_devices").select("*").eq(
        "id",
        job.device_id,
      ).single();
      const { data: notice } = await client.from("notifications").select("*")
        .eq("id", job.notification_id).single();
      const { data: profile } = await client.from("profiles").select(
        "status,must_change_password",
      ).eq("id", device?.user_id).single();
      if (
        !device || !notice || notice.recipient_user_id !== device.user_id ||
        profile?.status !== "active" || profile.must_change_password
      ) {
        await client.from("push_jobs").delete().eq("id", job.id);
        continue;
      }
      const payload = {
        title: notice.title,
        body: "Apri GalileoHub per leggere la comunicazione.",
        id: notice.id,
        url: notice.type === "merch.order_paid" ? "/merchandising" : "/",
      };
      if (device.platform === "web") {
        const { publicKey, privateKey } = await webPushConfig(client);
        await webpush.sendNotification(
          device.subscription,
          JSON.stringify(payload),
          {
            TTL: 3600,
            timeout: 8000,
            vapidDetails: {
              subject: "mailto:info.teamgalileo@gmail.com",
              publicKey,
              privateKey,
            },
          },
        );
      } else {
        const response = await nativeSend(
          device.platform,
          device.address,
          payload,
        );
        if (!response.ok) {
          if (response.status === 410) {
            await client.from("push_devices").delete().eq("id", device.id);
          }
          throw new Error("NATIVE_PUSH_FAILED");
        }
      }
      await client.from("push_jobs").update({ status: "sent" }).eq("id", job.id)
        .eq("attempts", job.attempts);
    } catch (error) {
      if ((error as { statusCode?: number })?.statusCode === 410) {
        await client
          .from("push_devices").delete().eq(
            "id",
            job.device_id,
          );
      } else {await client.from("push_jobs").update({
          status: "pending",
          next_attempt_at: new Date(
            Date.now() + Math.pow(2, job.attempts) * 60000,
          ).toISOString(),
        }).eq("id", job.id).eq("attempts", job.attempts);}
    }
  }
}

