let registration: ServiceWorkerRegistration | null = null;
let reloadRequested = false;

export function registerPwa() {
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;

  // Register immediately instead of waiting for the full window load event.
  // This lets Chromium evaluate PWA installability as soon as possible.
  void setupServiceWorker();

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadRequested) {
      window.location.reload();
    }
  });
}

async function setupServiceWorker() {
  try {
    registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });

    await navigator.serviceWorker.ready;

    if (registration.waiting && navigator.serviceWorker.controller) {
      window.dispatchEvent(new CustomEvent("galileo:pwa-update-ready"));
    }

    registration.addEventListener("updatefound", () => {
      const worker = registration?.installing;
      if (!worker) return;

      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          window.dispatchEvent(new CustomEvent("galileo:pwa-update-ready"));
        }
      });
    });

    const checkForUpdates = () => {
      if (document.visibilityState === "visible") {
        void registration?.update();
      }
    };

    document.addEventListener("visibilitychange", checkForUpdates);
    window.addEventListener("focus", checkForUpdates);
    window.setInterval(() => {
      void registration?.update();
    }, 60 * 60 * 1000);
  } catch (error) {
    console.error("Registrazione PWA non riuscita:", error);
  }
}

export async function applyPwaUpdate() {
  if (!registration) return;

  if (!registration.waiting) {
    await registration.update();
  }

  if (registration.waiting) {
    reloadRequested = true;
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
  }
}
