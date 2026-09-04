import { createClient } from "npm:@supabase/supabase-js@2.112.4";

function resolveSupabaseSecretKey(): string | undefined {
  const keysJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keysJson) {
    try {
      const keys = JSON.parse(keysJson) as Record<string, unknown>;
      const defaultKey = keys.default;
      if (typeof defaultKey === "string" && defaultKey.trim()) {
        return defaultKey.trim();
      }
    } catch {
      // Fall back to the legacy service-role key while the project is migrated.
    }
  }

  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || undefined;
}

export function createServiceClient() {
  const url = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceKey = resolveSupabaseSecretKey();

  if (!url || !serviceKey) {
    throw new Error("Missing Supabase server configuration");
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
