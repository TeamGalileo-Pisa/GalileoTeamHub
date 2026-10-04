import { appConfig } from "./config";
import { supabase } from "./supabase";

export async function downloadMembershipExport() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error("Accedi nuovamente per scaricare il file.");

  const response = await fetch(`${appConfig.supabaseUrl}/functions/v1/community`, {
    method: "POST",
    headers: {
      apikey: appConfig.supabasePublishableKey,
      authorization: `Bearer ${data.session.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action: "export_membership_excel" }),
  });

  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string };
    const messages: Record<string, string> = {
      UNAUTHORIZED: "Accedi nuovamente.",
      FORBIDDEN: "Non hai i permessi necessari.",
      SAVE_FAILED: "Esportazione non riuscita. Riprova tra poco.",
    };
    throw new Error(messages[result.error ?? ""] ?? "Esportazione non riuscita.");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "adesioni-team-galileo.xlsx";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

