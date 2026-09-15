const APP_SHELL = "galileohub-network-only-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("galileohub-") && key !== APP_SHELL)
            .map((key) => caches.delete(key)),
        ),
      ),
    ]),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Supabase, Gmail and every other external/API request stay completely outside
  // the service worker. This keeps bookings, authentication and live data online-only.
  if (url.origin !== self.location.origin) return;

  // Navigations are always fetched fresh. We deliberately do not cache the Hub
  // while recruitment is active, so an installed PWA cannot serve stale booking UI.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request, { cache: "no-store" }));
  }
});
