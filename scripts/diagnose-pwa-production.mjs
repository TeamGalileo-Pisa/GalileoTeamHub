import { writeFile } from "node:fs/promises";

const target = process.env.PWA_TARGET ?? "https://galileohub.info-teamgalileo.workers.dev";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function probe(path, binary = false) {
  const url = new URL(path, target).href;
  const response = await fetch(url, { redirect: "follow", cache: "no-store" });
  const headers = Object.fromEntries(response.headers.entries());
  if (binary) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    let png = null;
    if (
      bytes.length >= 24 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    ) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      png = { width: view.getUint32(16), height: view.getUint32(20), bytes: bytes.length };
    }
    return { url, status: response.status, headers, png };
  }

  const text = await response.text();
  return { url, status: response.status, headers, text: text.slice(0, 12000) };
}

async function getChromePage() {
  for (let i = 0; i < 30; i += 1) {
    try {
      const response = await fetch("http://127.0.0.1:9222/json/list");
      if (response.ok) {
        const pages = await response.json();
        const page = pages.find((item) => item.type === "page");
        if (page?.webSocketDebuggerUrl) return page;
      }
    } catch {}
    await sleep(500);
  }
  throw new Error("Chrome DevTools endpoint unavailable");
}

async function cdpDiagnostics() {
  const page = await getChromePage();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const events = [];

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    } else if (message.method) {
      events.push(message.method);
    }
  });

  const send = (method, params = {}) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Page.navigate", { url: target });
  await sleep(10000);

  const [manifest, installability, icons, appId, runtime] = await Promise.all([
    send("Page.getAppManifest").catch((error) => ({ error: String(error) })),
    send("Page.getInstallabilityErrors").catch((error) => ({ error: String(error) })),
    send("Page.getManifestIcons").catch((error) => ({ error: String(error) })),
    send("Page.getAppId").catch((error) => ({ error: String(error) })),
    send("Runtime.evaluate", {
      expression: `(async () => ({
        href: location.href,
        secureContext: window.isSecureContext,
        manifestHref: document.querySelector('link[rel="manifest"]')?.href ?? null,
        serviceWorkerSupported: 'serviceWorker' in navigator,
        serviceWorkerController: navigator.serviceWorker?.controller?.scriptURL ?? null,
        registrations: 'serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).map(r => ({ scope: r.scope, active: r.active?.scriptURL ?? null, waiting: r.waiting?.scriptURL ?? null, installing: r.installing?.scriptURL ?? null })) : []
      }))()`,
      awaitPromise: true,
      returnByValue: true,
    }).catch((error) => ({ error: String(error) })),
  ]);

  ws.close();
  return {
    manifest,
    installability,
    icons: icons && typeof icons.primaryIcon === "string" ? { ...icons, primaryIcon: `[data URL omitted: ${icons.primaryIcon.length} chars]` } : icons,
    appId,
    runtime: runtime?.result?.value ?? runtime,
    observedEvents: [...new Set(events)].sort(),
  };
}

const root = await probe("/");
const manifestResponse = await probe("/manifest.webmanifest?v=2");
const serviceWorker = await probe("/sw.js");
const icon192 = await probe("/icons/galileohub-192-v2.png", true);
const icon512 = await probe("/icons/galileohub-512-v2.png", true);

let parsedManifest = null;
let manifestParseError = null;
try {
  parsedManifest = JSON.parse(manifestResponse.text);
} catch (error) {
  manifestParseError = String(error);
}

const chrome = await cdpDiagnostics();
const result = {
  generatedAt: new Date().toISOString(),
  target,
  http: {
    root: { ...root, text: root.text.slice(0, 3000) },
    manifest: { ...manifestResponse, text: manifestResponse.text.slice(0, 3000) },
    serviceWorker: { ...serviceWorker, text: serviceWorker.text.slice(0, 3000) },
    icon192,
    icon512,
  },
  parsedManifest,
  manifestParseError,
  chrome,
};

await writeFile("pwa-production-diagnostics.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
