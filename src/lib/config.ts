const productionSupabaseUrl = "https://zxxgbemmzriysswaybnv.supabase.co";
const productionSupabasePublishableKey =
  "sb_publishable_Aifq2BK44rlNsqOcm4an3Q_WItYh1k-";

// Vite variables remain the preferred configuration source. The checked-in
// production fallback only contains public browser credentials, never a
// service-role/secret key. This keeps the deployed SPA operational if the
// Cloudflare build variables are accidentally removed or temporarily absent.
const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL?.trim() || productionSupabaseUrl;
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  productionSupabasePublishableKey;

export const appConfig = {
  supabaseUrl,
  supabasePublishableKey,
  authEmailDomain:
    import.meta.env.VITE_AUTH_EMAIL_DOMAIN?.trim() ||
    "auth.teamgalileo.local",
  timezone: import.meta.env.VITE_APP_TIMEZONE?.trim() || "Europe/Rome",
  hasSupabaseConfiguration: Boolean(supabaseUrl && supabasePublishableKey),
} as const;
