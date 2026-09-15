export type InstallPromptChoice = {
  outcome: "accepted" | "dismissed";
  platform: string;
};

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallPromptChoice>;
};

export function registerGalileoPwa() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // PWA support is progressive enhancement: a registration failure must never
      // block login, bookings or the rest of GalileoHub.
    });
  });
}

export function isStandaloneMode() {
  const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    standaloneNavigator.standalone === true
  );
}

export function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isMacSafari() {
  const userAgent = navigator.userAgent;
  const safari = /safari/i.test(userAgent) && !/chrome|crios|chromium|edg|opr|android/i.test(userAgent);
  return /macintosh|mac os x/i.test(userAgent) && safari && !isIosDevice();
}

export function getCurrentBuildId() {
  return document
    .querySelector<HTMLMetaElement>('meta[name="galileohub-build-id"]')
    ?.content.trim();
}

export async function getLatestBuildId() {
  const response = await fetch(`/version.json?ts=${Date.now()}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) throw new Error("Version check failed");

  const payload = (await response.json()) as { buildId?: unknown };
  return typeof payload.buildId === "string" ? payload.buildId : undefined;
}

export async function reloadLatestVersion() {
  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.getRegistration("/");
    await registration?.update();
  }

  window.location.reload();
}
