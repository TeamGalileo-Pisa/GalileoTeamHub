export type DiagnosticLevel = "ok" | "warn" | "error";
export type DiagnosticLine = { label: string; value: string; level: DiagnosticLevel };

/** Nome leggibile del servizio push da cui passa questo dispositivo. */
export function pushServiceName(endpoint: string): string {
  let host: string;
  try {
    host = new URL(endpoint).hostname;
  } catch {
    return "sconosciuto";
  }
  if (host === "fcm.googleapis.com") return "Google (Android e Chrome)";
  if (host === "web.push.apple.com") return "Apple (iPhone, iPad e Safari)";
  if (host === "updates.push.services.mozilla.com") return "Mozilla (Firefox)";
  if (host.endsWith(".notify.windows.com")) return "Microsoft (Edge e Windows)";
  return "sconosciuto";
}

const permissionText: Record<NotificationPermission, string> = {
  granted: "Consentite",
  denied: "Bloccate: riabilitale dalle impostazioni del sito e del telefono",
  default: "Non ancora richieste",
};

export function permissionLabel(permission: NotificationPermission): string {
  return permissionText[permission];
}

/** Controlla, senza cambiare nulla, tutto ciò che serve perché una push arrivi su questo dispositivo. */
export async function collectPushDiagnostics(): Promise<DiagnosticLine[]> {
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return [{ label: "Supporto", value: "Questo browser non supporta le notifiche push.", level: "error" }];
  }
  const lines: DiagnosticLine[] = [];
  const permission = Notification.permission;
  lines.push({
    label: "Permesso notifiche",
    value: permissionLabel(permission),
    level: permission === "granted" ? "ok" : "error",
  });
  const installed = window.matchMedia?.("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  lines.push({
    label: "Aperta come",
    value: installed ? "App installata (schermata Home)" : "Pagina del browser",
    level: "ok",
  });
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) {
    lines.push({ label: "Service worker", value: "Non registrato: ricarica la pagina", level: "error" });
    return lines;
  }
  lines.push({
    label: "Service worker",
    value: registration.active ? "Attivo" : "Non attivo",
    level: registration.active ? "ok" : "error",
  });
  if (registration.waiting) {
    lines.push({
      label: "Aggiornamento",
      value: "Scaricato ma non ancora applicato: chiudi e riapri l'app",
      level: "warn",
    });
  }
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    lines.push({
      label: "Registrazione push",
      value: "Assente su questo dispositivo: usa «Reimposta notifiche»",
      level: "error",
    });
    return lines;
  }
  const expired = subscription.expirationTime !== null && subscription.expirationTime < Date.now();
  lines.push({
    label: "Registrazione push",
    value: expired
      ? "Scaduta: usa «Reimposta notifiche»"
      : `Presente, tramite ${pushServiceName(subscription.endpoint)}`,
    level: expired ? "error" : "ok",
  });
  return lines;
}

/** Mostra una notifica direttamente dal telefono, senza passare dal server: prova che il sistema le visualizza. */
export async function showLocalTestNotification(): Promise<void> {
  if (!("serviceWorker" in navigator) || !("Notification" in window)) {
    throw new Error("Questo browser non supporta le notifiche.");
  }
  if (Notification.permission !== "granted") {
    throw new Error("Le notifiche non sono consentite per questo sito.");
  }
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification("Prova GalileoHub (locale)", {
    body: "Se vedi questa notifica, il telefono mostra le notifiche di GalileoHub.",
    icon: "/icons/galileohub-192-v2.png",
    badge: "/icons/galileohub-192-v2.png",
    tag: "diagnostica-locale",
    data: { url: "/notifiche" },
  });
}
