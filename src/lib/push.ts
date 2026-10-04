import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "./supabase";
async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("push-device", {
    body,
  });
  if (error) {
    throw new Error(
      "Registrazione notifiche non riuscita. Verifica la configurazione push del server.",
    );
  }
  return data;
}
const key = "galileo-push-address";

export async function pushIsReady() {
  const address = localStorage.getItem(key);
  if (!address) return false;

  if (Capacitor.isNativePlatform()) {
    const permission = await PushNotifications.checkPermissions();
    return permission.receive === "granted";
  }

  if (!("Notification" in window) || Notification.permission !== "granted" ||
    !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return false;
  }
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return false;
  const subscription = await registration.pushManager.getSubscription();
  return Boolean(subscription && subscription.endpoint === address);
}

export async function enablePush() {
  if (Capacitor.isNativePlatform()) {
    const permission = await PushNotifications.requestPermissions();
    if (permission.receive !== "granted") {
      throw new Error(
        "Autorizza le notifiche nelle impostazioni del dispositivo.",
      );
    }
    await new Promise<void>((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          reject(
            new Error("Registrazione push scaduta. Verificare Firebase/APNs."),
          );
        }
      }, 20000);
      void PushNotifications.addListener("registration", async (token) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          await invoke({
            platform: Capacitor.getPlatform(),
            address: token.value,
          });
          localStorage.setItem(key, token.value);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      void PushNotifications.addListener("registrationError", () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(new Error("Registrazione push non riuscita."));
      });
      void PushNotifications.register().catch(reject);
    });
    return;
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error(
      "Su iPhone/iPad aggiungi GalileoHub alla schermata Home e aprilo da lì.",
    );
  }
  if (await Notification.requestPermission() !== "granted") {
    throw new Error("Autorizza le notifiche nelle impostazioni del browser.");
  }
  const { publicKey } = await invoke({ action: "config" });
  if (!publicKey) {
    throw new Error("Il server non ha ancora configurato le chiavi push.");
  }
  const registration = await navigator.serviceWorker.ready;
  const decoded = atob(publicKey.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = Uint8Array.from(decoded, (c: string) => c.charCodeAt(0));
  const subscription = await registration.pushManager.getSubscription() ??
    await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: bytes,
    });
  await invoke({
    platform: "web",
    address: subscription.endpoint,
    subscription: subscription.toJSON(),
  });
  localStorage.setItem(key, subscription.endpoint);
}
export async function disablePush() {
  const address = localStorage.getItem(key);
  if (!address) return;
  await invoke({ action: "remove", address });
  localStorage.removeItem(key);
  if (Capacitor.isNativePlatform()) await PushNotifications.unregister();
  else if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.getRegistration();
    await (await registration?.pushManager.getSubscription())?.unsubscribe();
  }
}

