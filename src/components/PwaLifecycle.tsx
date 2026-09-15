import { Download, RefreshCw, Share2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  type BeforeInstallPromptEvent,
  getCurrentBuildId,
  getLatestBuildId,
  isIosDevice,
  isMacSafari,
  isStandaloneMode,
  reloadLatestVersion,
} from "../lib/pwa";

const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export function PwaLifecycle() {
  const location = useLocation();
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => isStandaloneMode());
  const [installDismissed, setInstallDismissed] = useState(
    () => sessionStorage.getItem("galileohub-install-dismissed") === "1",
  );
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updating, setUpdating] = useState(false);

  const ios = useMemo(() => isIosDevice(), []);
  const macSafari = useMemo(() => isMacSafari(), []);
  const isPublicBooking = location.pathname.startsWith("/book/");

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      const promptEvent = event as BeforeInstallPromptEvent;
      promptEvent.preventDefault();
      setInstallPrompt(promptEvent);
    };

    const handleInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      sessionStorage.removeItem("galileohub-install-dismissed");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  useEffect(() => {
    const currentBuildId = getCurrentBuildId();
    if (!currentBuildId) return;

    const checkVersion = async () => {
      try {
        const latestBuildId = await getLatestBuildId();
        if (latestBuildId && latestBuildId !== currentBuildId) {
          setUpdateAvailable(true);
        }
      } catch {
        // A failed version check is intentionally silent: connectivity problems
        // must never interrupt recruitment or any Hub operation.
      }
    };

    void checkVersion();
    const interval = window.setInterval(() => void checkVersion(), VERSION_CHECK_INTERVAL_MS);
    const handleFocus = () => void checkVersion();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void checkVersion();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const installApp = async () => {
    if (!installPrompt) return;

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);

    if (choice.outcome === "accepted") setInstalled(true);
  };

  const dismissInstall = () => {
    sessionStorage.setItem("galileohub-install-dismissed", "1");
    setInstallDismissed(true);
  };

  const updateApp = async () => {
    setUpdating(true);
    try {
      await reloadLatestVersion();
    } catch {
      window.location.reload();
    }
  };

  if (isPublicBooking) return null;

  if (updateAvailable) {
    return (
      <aside className="pwa-notice pwa-notice--update" role="status" aria-live="polite">
        <span className="pwa-notice__icon" aria-hidden="true">
          <RefreshCw size={20} />
        </span>
        <div className="pwa-notice__body">
          <strong>GalileoHub è stata aggiornata</strong>
          <p>
            Sono state apportate modifiche o migliorie alla Hub. Non serve disinstallare
            l’app: aggiorna ora per caricare la versione più recente.
          </p>
          <button className="button button--primary pwa-notice__action" type="button" onClick={updateApp} disabled={updating}>
            {updating ? "Aggiornamento…" : "Aggiorna GalileoHub"}
          </button>
        </div>
      </aside>
    );
  }

  const showManualInstall = !installed && !installDismissed && (ios || macSafari);
  const showPromptInstall = !installed && !installDismissed && Boolean(installPrompt);

  if (!showManualInstall && !showPromptInstall) return null;

  return (
    <aside className="pwa-notice" role="status">
      <span className="pwa-notice__icon" aria-hidden="true">
        {showPromptInstall ? <Download size={20} /> : <Share2 size={20} />}
      </span>
      <div className="pwa-notice__body">
        <strong>Installa GalileoHub</strong>
        {showPromptInstall ? (
          <>
            <p>Puoi installare GalileoHub su questo dispositivo e aprirla come una normale app.</p>
            <button className="button button--primary pwa-notice__action" type="button" onClick={installApp}>
              Installa
            </button>
          </>
        ) : ios ? (
          <p>Su iPhone o iPad: apri il menu Condividi di Safari e scegli “Aggiungi alla schermata Home”.</p>
        ) : (
          <p>Su Safari per Mac: usa File → Aggiungi al Dock per installare GalileoHub.</p>
        )}
      </div>
      <button className="pwa-notice__close" type="button" aria-label="Nascondi suggerimento installazione" onClick={dismissInstall}>
        <X size={18} />
      </button>
    </aside>
  );
}
