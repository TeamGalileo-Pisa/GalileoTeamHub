import { createClient } from "@supabase/supabase-js";
import { appConfig } from "./config";

const fallbackUrl = "https://not-configured.supabase.co";
const fallbackKey = "not-configured";

export const supabase = createClient(
  appConfig.supabaseUrl || fallbackUrl,
  appConfig.supabasePublishableKey || fallbackKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);

