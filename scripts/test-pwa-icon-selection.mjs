import http from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const { default: CDP } = await import(process.env.CDP_MODULE ?? "chrome-remote-interface");
const chromeBin = process.env.CHROME_BIN;
if (!chromeBin) throw new Error("CHROME_BIN is not set");

const icon192 = await readFile("public/icons/galileohub-192-v2.png");
const icon512 = await readFile("public/icons/galileohub-512-v2.png");

function baseManifest(name, variant, icons) {
  return { name, short_name: name, start_url: `/${variant}/`, scope: `/${variant}/`, display: "standalone", icons };
}

const manifests = {
  current: baseManifest("Current", "current", [
    { src: "/icon192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  ]),
  robust: baseManifest("Robust", "robust", [
    { src: "/icon192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon512.png", sizes: "512x512", type: "image/png" },
    { src: "/icon512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
  ]),
  exact144: baseManifest("Exact144", "exact144", [
    { src: "/icon192.png", sizes: "144x144", type: "image/png", purpose: "any" },
  ]),
  anysize: baseManifest("AnySize", "anysize", [
    { src: "/icon512.png", sizes: "any", type: "image/png", purpose: "any" },
  ]),
  noType: baseManifest("NoType", "noType", [
    { src: "/icon192.png", sizes: "192x192", purpose: "any" },
    { src: "/icon512.png", sizes: "512x512", purpose: "any" },
  ]),
};

const page = (variant) => `<!doctype html><html><head><meta charset="utf-8"><link rel="manifest" href="/${variant}.webmanifest"></head><body>${variant}<script>navigator.serviceWorker.register('/sw-test.js',{scope:'/'}).then(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller) location.reload();});</script></body></html>`;
const sw = `self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',()=>{});`;

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://127.0.0.1:4173").pathname;
  if (pathname === "/icon192.png") { res.writeHead(200,{"Content-Type":"image/png","Cache-Control":"no-store"}); return res.end(icon192); }
  if (pathname === "/icon512.png") { res.writeHead(200,{"Content-Type":"image/png","Cache-Control":"no-store"}); return res.end(icon512); }
  if (pathname === "/sw-test.js") { res.writeHead(200,{"Content-Type":"text/javascript","Cache-Control":"no-store"}); return res.end(sw); }
  const manifestMatch = pathname.match(/^\/(current|robust|exact144|anysize|noType)\.webmanifest$/);
  if (manifestMatch) { res.writeHead(200,{"Content-Type":"application/manifest+json","Cache-Control":"no-store"}); return res.end(JSON.stringify(manifests[manifestMatch[1]])); }
  const pageMatch = pathname.match(/^\/(current|robust|exact144|anysize|noType)\/?$/);
  if (pageMatch) { res.writeHead(200,{"Content-Type":"text/html","Cache-Control":"no-store"}); return res.end(page(pageMatch[1])); }
  res.writeHead(404); res.end();
});
await new Promise((resolve) => server.listen(4173, "127.0.0.1", resolve));

const chrome = spawn(chromeBin,["--headless=new","--no-sandbox","--disable-gpu","--remote-debugging-port=9223","--remote-allow-origins=*","--user-data-dir=/tmp/galileo-pwa-icon-test","about:blank"],{stdio:"ignore"});
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
async function waitChrome(){for(let i=0;i<30;i++){try{const r=await fetch('http://127.0.0.1:9223/json/version');if(r.ok)return;}catch{}await sleep(500);}throw new Error('test Chrome unavailable');}

const out={};
try {
  await waitChrome();
  const client = await CDP({host:"127.0.0.1",port:9223});
  const {Page,Runtime} = client;
  await Promise.all([Page.enable(),Runtime.enable()]);
  for (const variant of Object.keys(manifests)) {
    await Page.navigate({url:`http://127.0.0.1:4173/${variant}/`});
    await sleep(2500);
    await Page.reload({ignoreCache:true});
    await sleep(2000);
    out[variant]={
      manifest: await Page.getAppManifest(),
      installability: await Page.getInstallabilityErrors(),
      runtime:(await Runtime.evaluate({expression:`({href:location.href,controller:navigator.serviceWorker.controller?.scriptURL??null})`,returnByValue:true})).result.value,
    };
  }
  await client.close();
  console.log(JSON.stringify(out,null,2));
  await writeFile("pwa-icon-selection.json",JSON.stringify(out,null,2));
} finally {
  chrome.kill("SIGTERM");
  await new Promise((resolve)=>server.close(resolve));
}
