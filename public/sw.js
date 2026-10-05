const APP_VERSION = "2026-10-05T13:49:36.734Z";

self.addEventListener("install", () => {
  // Do not activate over an app that is already open. The user chooses when to update.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data?.json() ?? {}; } catch { /* generic notification */ }
  event.waitUntil(self.registration.showNotification(payload.title || "GalileoHub", {
    body: payload.body || "Hai una nuova comunicazione.", icon: "/icons/galileohub-192-v2.png",
    badge: "/icons/galileohub-192-v2.png", tag: payload.id, data: {url:payload.url || "/"}
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => "focus" in client);
      if (existing) {
        existing.navigate(target);
        return existing.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Network-only by design: GalileoHub handles live recruitment data.
  // Bookings, availability and authentication are never cached by this service worker.
  event.respondWith(fetch(request));
});

