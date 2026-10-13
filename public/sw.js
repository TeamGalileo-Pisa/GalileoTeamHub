const APP_VERSION = "2026-10-13T06:21:58.199Z";

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

function resolveNotificationTarget(raw) {
  try {
    const url = new URL(typeof raw === "string" ? raw : "/", self.location.origin);
    if (url.origin !== self.location.origin) return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}

// Ask an already-open app window to navigate to the message. The app answers on the
// MessageChannel; if it does not (older build still open), fall back to navigate().
function openInExistingClient(client, path) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      client.navigate(path).catch(() => {}).finally(resolve);
    }, 1200);
    channel.port1.onmessage = () => {
      clearTimeout(timer);
      resolve();
    };
    client.postMessage({ type: "NOTIFICATION_OPEN", url: path }, [channel.port2]);
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = resolveNotificationTarget(event.notification.data?.url);
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = clients.find((client) => client.visibilityState === "visible" && "focus" in client) ||
      clients.find((client) => "focus" in client);
    if (existing) {
      try { await existing.focus(); } catch { /* focus can be refused; navigation still works */ }
      await openInExistingClient(existing, path);
      return;
    }
    await self.clients.openWindow(path);
  })());
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
