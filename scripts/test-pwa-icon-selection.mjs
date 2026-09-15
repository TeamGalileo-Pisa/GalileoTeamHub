import http from "node:http";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const { default: CDP } = await import(process.env.CDP_MODULE ?? "chrome-remote-interface");
const chromeBin = process.env.CHROME_BIN;
if (!chromeBin) throw new Error("CHROME_BIN is not set");

const icon192 = await readFile("public/icons/galileohub-192-v2.png");
const icon512 = await readFile("public/icons/galileohub-512-v2.png");

const manifests = {
  current: {
    name: "GalileoHub current test",
    short_name: "GalileoCurrent",
    start_url: "/current/",
    scope: "/current/",
    display: "standalone",
    icons: [
      { src: "/icon192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  },
  robust: {
    name: "GalileoHub robust test",
    short_name: "GalileoRobust",
    start_url: "/robust/",
    scope: "/robust/",
    display: "standalone",
    icons: [
      { src: "/icon192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ],
  },
};

const page = (variant) => `<!doctype html><html><head><meta charset="utf-8"><link rel="manifest" href="/${variant}.webmanifest"></head><body>${variant}<script>navigator.serviceWorker.register('/sw-test.js',{scope:'/'}).then(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller) location.reload();});</script></body></html>`;
const sw = `self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',()=>{});`;

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://127.0.0.1:4173").pathname;
  if (pathname === "/icon192.png") { res.writeHead(200,{"Content-Type":"image/png","Cache-Control":"no-store"}); return res.end(icon192); }
  if (pathname === "/icon512.png") { res.writeHead(200,{"Content-Type":"image/png","Cache-Control":"no-store"}); return res.end(icon512); }
  if (pathname === "/sw-test.js") { res.writeHead(200,{"Content-Type":"text/javascript","Cache-Control":"no-store"}); return res.end(sw); }
  if (pathname === "/current.webmanifest") { res.writeHead(200,{"Content-Type":"application/manifest+json","Cache-Control":"no-store"}); return res.end(JSON.stringify(manifests.current)); }
  if (pathname === "/robust.webmanifest") { res.writeHead(200,{"Content-Type":"application/manifest+json","Cache-Control":"no-store"}); return res.end(JSON.stringify(manifests.robust)); }
  if (pathname.startsWith("/current")) { res.writeHead(200,{"Content-Type":"text/html","Cache-Control":"no-store"}); return res.end(page("current")); }
  if (pathname.startsWith("/robust")) { res.writeHead(200,{"Content-Type":"text/html","Cache-Control":"no-store"}); return res.end(page("robust")); }
  res.writeHead(404); res.end();
});
await new Promise((resolve) => server.listen(4173, "127.0.0.1", resolve));

const chrome = spawn(chromeBin,["--headless=new","--no-sandbox","--disable-gpu","--remote-debugging-port=9223","--remote-allow-origins=*","--user-data-dir=/tmp/galileo-pwa-icon-test","about:blank"],{stdio:"ignore"});
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
async function waitChrome(){for(let i=0;i<30;i++){try{const r=await fetch('http://127.0.0.1:9223/json/version');if(r.ok)return;}catch{}await sleep(500);}throw new Error('test Chrome unavailable');}

try {
  await waitChrome();
  const client = await CDP({host:"127.0.0.1",port:9223});
  const {Page,Runtime} = client;
  await Promise.all([Page.enable(),Runtime.enable()]);
  const out={};
  for (const variant of ["current","robust"]) {
    await Page.navigate({url:`http://127.0.0.1:4173/${variant}/`});
    await sleep(4000);
    await Page.reload({ignoreCache:true});
    await sleep(3000);
    out[variant]={
      manifest: await Page.getAppManifest(),
      installability: await Page.getInstallabilityErrors(),
      runtime:(await Runtime.evaluate({expression:`({href:location.href,controller:navigator.serviceWorker.controller?.scriptURL??null})`,returnByValue:true})).result.value,
    };
  }
  console.log(JSON.stringify(out,null,2));
  await client.close();
} finally {
  chrome.kill("SIGTERM");
  await new Promise((resolve)=>server.close(resolve));
}
