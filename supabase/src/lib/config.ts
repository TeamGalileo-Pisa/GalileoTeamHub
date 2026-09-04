const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

export const appConfig = {
  supabaseUrl,
  supabasePublishableKey,
  authEmailDomain:
    import.meta.env.VITE_AUTH_EMAIL_DOMAIN?.trim() ||
    "auth.teamgalileo.local",
  timezone: import.meta.env.VITE_APP_TIMEZONE?.trim() || "Europe/Rome",
  hasSupabaseConfiguration: Boolean(supabaseUrl && supabasePublishableKey),
} as const;

