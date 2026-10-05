import { appConfig } from "./config";
import { supabase } from "./supabase";

export async function downloadMerchOrdersExport() {
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
    body: JSON.stringify({ action: "export_merch_orders_excel" }),
  });

  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (result.error === "FORBIDDEN") throw new Error("Non hai i permessi per scaricare il registro ordini.");
    if (result.error === "UNAUTHORIZED") throw new Error("Accedi nuovamente.");
    throw new Error("Esportazione non riuscita. Riprova tra poco.");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ordini-merchandising-team-galileo.xlsx";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

