import { writeFile } from "node:fs/promises";

const cdpModule = process.env.CDP_MODULE ?? "chrome-remote-interface";
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

async function cdpDiagnostics() {
  const { default: CDP } = await import(cdpModule);
  const client = await CDP({ host: "127.0.0.1", port: 9222 });
  const { Page, Runtime, Network } = client;
  await Promise.all([Page.enable(), Runtime.enable(), Network.enable()]);
  await Page.navigate({ url: target });
  await sleep(10000);

  const [manifest, installability, icons, appId, runtime] = await Promise.all([
    Page.getAppManifest().catch((error) => ({ error: String(error) })),
    Page.getInstallabilityErrors().catch((error) => ({ error: String(error) })),
    Page.getManifestIcons().catch((error) => ({ error: String(error) })),
    Page.getAppId().catch((error) => ({ error: String(error) })),
    Runtime.evaluate({
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

  await client.close();
  return {
    manifest,
    installability,
    icons: icons && typeof icons.primaryIcon === "string" ? { ...icons, primaryIcon: `[data URL omitted: ${icons.primaryIcon.length} chars]` } : icons,
    appId,
    runtime: runtime?.result?.value ?? runtime,
  };
}

const result = {
  generatedAt: new Date().toISOString(),
  target,
  http: {},
  parsedManifest: null,
  manifestParseError: null,
  chrome: null,
  chromeError: null,
};

try {
  result.http.root = await probe("/");
  result.http.manifest = await probe("/manifest.webmanifest?v=2");
  result.http.serviceWorker = await probe("/sw.js");
  result.http.icon192 = await probe("/icons/galileohub-192-v2.png", true);
  result.http.icon512 = await probe("/icons/galileohub-512-v2.png", true);
  try {
    result.parsedManifest = JSON.parse(result.http.manifest.text);
  } catch (error) {
    result.manifestParseError = String(error);
  }
} catch (error) {
  result.httpError = String(error?.stack ?? error);
}

try {
  result.chrome = await cdpDiagnostics();
} catch (error) {
  result.chromeError = String(error?.stack ?? error);
}

for (const key of ["root", "manifest", "serviceWorker"]) {
  if (result.http[key]?.text) result.http[key].text = result.http[key].text.slice(0, 3000);
}

await writeFile("pwa-production-diagnostics.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (result.httpError || result.chromeError) process.exitCode = 1;
