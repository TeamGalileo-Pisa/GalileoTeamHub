import webpush from "npm:web-push@3.6.7";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.112.4";

export async function webPushConfig(client: SupabaseClient) {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  if (publicKey && privateKey) return { publicKey, privateKey };
  const { data, error } = await client.rpc("read_web_push_config");
  if (error) throw new Error("VAPID_NOT_CONFIGURED");
  if (data) return data as { publicKey: string; privateKey: string };
  const generated = webpush.generateVAPIDKeys();
  const { data: saved, error: saveError } = await client.rpc("initialize_web_push_config", {
    p_public: generated.publicKey, p_private: generated.privateKey,
  });
  if (saveError || !saved) throw new Error("VAPID_NOT_CONFIGURED");
  return saved as { publicKey: string; privateKey: string };
}
