import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const publicDir = resolve(process.cwd(), "public");
await mkdir(publicDir, { recursive: true });

const buildId =
  process.env.GITHUB_SHA ??
  process.env.CF_PAGES_COMMIT_SHA ??
  process.env.CF_VERSION_METADATA_ID ??
  new Date().toISOString();

const serviceWorker = `const APP_VERSION = ${JSON.stringify(buildId)};

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

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Network-only by design: GalileoHub handles live recruitment data.
  // Bookings, availability and authentication are never cached by this service worker.
  event.respondWith(fetch(request));
});
`;

await writeFile(resolve(publicDir, "sw.js"), serviceWorker, "utf8");
