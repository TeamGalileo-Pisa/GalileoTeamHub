import { useEffect, useState } from "react";
import { applyPwaUpdate } from "../pwa/registerPwa";

interface DeferredInstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone() {
  const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    standaloneNavigator.standalone === true
  );
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function PwaControls() {
  const [updateReady, setUpdateReady] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<DeferredInstallPrompt | null>(null);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem("galileo-pwa-dismissed") === "1");
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    const onUpdateReady = () => setUpdateReady(true);
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as DeferredInstallPrompt);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };

    window.addEventListener("galileo:pwa-update-ready", onUpdateReady);
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("galileo:pwa-update-ready", onUpdateReady);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismissInstall = () => {
    sessionStorage.setItem("galileo-pwa-dismissed", "1");
    setDismissed(true);
  };

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setInstallPrompt(null);
    }
  };

  if (updateReady) {
    return (
      <aside className="pwa-notice pwa-notice--update" role="status" aria-live="polite">
        <div>
          <strong>Aggiornamento GalileoHub disponibile</strong>
          <p>
            Sono state apportate modifiche o migliorie alla Hub. Non è necessario disinstallare
            l'app: puoi aggiornare in sicurezza mantenendo account, prenotazioni e dati invariati.
          </p>
        </div>
        <button type="button" className="button button--primary" onClick={() => void applyPwaUpdate()}>
          Aggiorna ora
        </button>
      </aside>
    );
  }

  if (installed || dismissed) return null;

  if (installPrompt) {
    return (
      <aside className="pwa-notice" role="status">
        <div>
          <strong>Installa GalileoHub</strong>
          <p>Aggiungi GalileoHub al dispositivo e aprilo come una normale app.</p>
        </div>
        <div className="pwa-notice__actions">
          <button type="button" className="button button--primary" onClick={() => void install()}>
            Installa
          </button>
          <button type="button" className="button button--ghost" onClick={dismissInstall}>
            Non ora
          </button>
        </div>
      </aside>
    );
  }

  if (isIos()) {
    return (
      <aside className="pwa-notice" role="status">
        <div>
          <strong>Installa GalileoHub su iPhone o iPad</strong>
          <p>In Safari usa Condividi → Aggiungi alla schermata Home.</p>
        </div>
        <button type="button" className="button button--ghost" onClick={dismissInstall}>
          Chiudi
        </button>
      </aside>
    );
  }

  return null;
}
