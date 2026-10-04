import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
export function registerMobileEvents() {
  if (!Capacitor.isNativePlatform()) return;
  void PushNotifications.addListener("pushNotificationActionPerformed", (event) => {
    const requestedRoute = event.notification.data?.url;
    const route = typeof requestedRoute === "string" && requestedRoute.startsWith("/") && !requestedRoute.startsWith("//")
      ? requestedRoute
      : "/";
    window.location.assign(route);
  });
  void PushNotifications.addListener(
    "pushNotificationReceived",
    (notification) => {
      // iOS presentationOptions controls system foreground banners. Android shows
      // the in-app status message here; background alerts are delivered by FCM.
      window.dispatchEvent(
        new CustomEvent("galileo-native-notice", {
          detail: notification.title ?? "Nuova comunicazione",
        }),
      );
    },
  );
}

