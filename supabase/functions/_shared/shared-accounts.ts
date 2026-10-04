import type { SupabaseClient } from "npm:@supabase/supabase-js@2.112.4";

export async function createSharedAccount(client: SupabaseClient, areaId: string) {
  const { data: area } = await client.from("areas").select("id,name,slug")
    .eq("id", areaId).eq("active", true).single();
  if (!area) throw new Error("INVALID_DATA");
  const { data: existing, error: lookupError } = await client.from("area_shared_accounts")
    .select("user_id").eq("area_id", area.id).maybeSingle();
  if (lookupError) throw new Error("SAVE_FAILED");
  if (existing) throw new Error("ACCOUNT_EXISTS");
  const password = "G!a9" + Array.from(crypto.getRandomValues(new Uint8Array(20)))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const username = "membri." + area.slug;
  const { data, error } = await client.auth.admin.createUser({
    email: username + "@" + (Deno.env.get("AUTH_EMAIL_DOMAIN") ?? "auth.teamgalileo.local"),
    password, email_confirm: true,
    user_metadata: { username, display_name: "Membri " + area.name },
  });
  if (error || !data.user) throw new Error("ACCOUNT_EXISTS");
  const { error: assignError } = await client.from("area_shared_accounts")
    .insert({ area_id: area.id, user_id: data.user.id });
  if (assignError) {
    await client.auth.admin.deleteUser(data.user.id);
    throw new Error("SAVE_FAILED");
  }
  return { username, temporaryPassword: password };
}
