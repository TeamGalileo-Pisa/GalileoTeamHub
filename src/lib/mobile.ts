import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
export function registerMobileEvents() {
  if (!Capacitor.isNativePlatform()) return;
  void PushNotifications.addListener("pushNotificationActionPerformed", () => {
    window.location.assign("/");
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
