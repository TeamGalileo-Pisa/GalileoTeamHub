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

export function supportsPushNotifications() {
  if (typeof navigator === "undefined") return false;
  return Capacitor.isNativePlatform() ||
    ("Notification" in window && "serviceWorker" in navigator && "PushManager" in window);
}

function webDeviceClass(): "mobile" | "desktop" {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    ? "mobile"
    : "desktop";
}

export async function pushIsReady() {
  if (Capacitor.isNativePlatform()) {
    const permission = await PushNotifications.checkPermissions();
    if (permission.receive !== "granted") return false;
    // Re-register silently after login so this device follows the current
    // account. The OS permission remains granted across sign-outs.
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => finish(new Error("Registrazione push scaduta.")), 20_000);
      let registrationListener: Awaited<ReturnType<typeof PushNotifications.addListener>> | undefined;
      let errorListener: Awaited<ReturnType<typeof PushNotifications.addListener>> | undefined;
      const cleanup = () => {
        window.clearTimeout(timeout);
        void registrationListener?.remove();
        void errorListener?.remove();
      };
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve();
      };
      void (async () => {
        registrationListener = await PushNotifications.addListener("registration", async (token) => {
          try {
            await invoke({ platform: Capacitor.getPlatform(), address: token.value });
            localStorage.setItem(key, token.value);
            finish();
          } catch (error) {
            finish(error instanceof Error ? error : new Error("Registrazione push non riuscita."));
          }
        });
        errorListener = await PushNotifications.addListener("registrationError", () => finish(new Error("Registrazione push non riuscita.")));
        await PushNotifications.register();
      })().catch((error: unknown) => finish(error instanceof Error ? error : new Error("Registrazione push non riuscita.")));
    });
    return true;
  }

  if (!("Notification" in window) || Notification.permission !== "granted" ||
    !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return false;
  }
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return false;
  const subscription = await registration.pushManager.getSubscription();
  // Checking status must never open the browser permission prompt. The user
  // can opt in explicitly from the notification setup page.
  if (!subscription) return false;
  // Re-register after login to associate the existing subscription with the
  // active account. This does not show the permission prompt again.
  await invoke({
    platform: "web",
    deviceClass: webDeviceClass(),
    address: subscription.endpoint,
    subscription: subscription.toJSON(),
  });
  localStorage.setItem(key, subscription.endpoint);
  return true;
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
    throw new Error("Questo browser non supporta le notifiche push. Apri GalileoHub con una versione recente di Chrome, Edge, Firefox o Safari.");
  }
  if (!("Notification" in window)) {
    throw new Error("Questo browser non consente le notifiche. Usa una versione recente di Chrome, Edge, Firefox o Safari.");
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
    deviceClass: webDeviceClass(),
    address: subscription.endpoint,
    subscription: subscription.toJSON(),
  });
  localStorage.setItem(key, subscription.endpoint);
}
export async function disablePush() {
  const address = localStorage.getItem(key);
  if (address) await invoke({ action: "remove", address });
  localStorage.removeItem(key);
  if (Capacitor.isNativePlatform()) {
    if (address) await PushNotifications.unregister();
  } else if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      if (!address) await invoke({ action: "remove", address: subscription.endpoint });
      await subscription.unsubscribe();
    }
  }
}

