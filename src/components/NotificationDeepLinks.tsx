import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

function safeRoute(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : null;
}

/**
 * When the user taps a push notification while the app is already open, the service
 * worker asks this component to go straight to the message (announcement or notification).
 */
export function NotificationDeepLinks() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "NOTIFICATION_OPEN") return;
      const route = safeRoute(event.data.url);
      event.ports[0]?.postMessage("ok");
      if (route) navigate(route);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [navigate]);

  return null;
}
