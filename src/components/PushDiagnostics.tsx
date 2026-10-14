import { Capacitor } from "@capacitor/core";
import { useState } from "react";
import { disablePush, enablePush, sendTestPush } from "../lib/push";
import { collectPushDiagnostics, showLocalTestNotification, type DiagnosticLine } from "../lib/pushDiagnostics";

type Message = { text: string; level: "ok" | "error" };

function testPushMessage(result: Awaited<ReturnType<typeof sendTestPush>>): Message {
  if (result.ok) {
    return {
      level: "ok",
      text: "Il servizio push ha accettato la prova. Entro pochi secondi dovrebbe comparire una notifica. Se non compare, il problema è nelle impostazioni del telefono: notifiche del browser o dell'app, batteria, Non disturbare.",
    };
  }
  if (result.reason === "NOT_REGISTERED") {
    return { level: "error", text: "Questo dispositivo non risulta registrato sul server: usa «Reimposta notifiche»." };
  }
  if (result.status === 404 || result.status === 410) {
    return { level: "error", text: "Il servizio push non riconosce più questo dispositivo: usa «Reimposta notifiche»." };
  }
  return {
    level: "error",
    text: `Il servizio push ha rifiutato la prova${result.status ? ` (codice ${result.status})` : ""}. Riprova tra poco.`,
  };
}

/** Pannello per capire perché le notifiche non compaiono su questo dispositivo. */
export function PushDiagnostics() {
  const [lines, setLines] = useState<DiagnosticLine[] | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);

  if (Capacitor.isNativePlatform()) return null;

  const run = async (action: () => Promise<Message | void>) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      if (result) setMessage(result);
    } catch (error) {
      setMessage({ level: "error", text: error instanceof Error ? error.message : "Operazione non riuscita." });
    } finally {
      setBusy(false);
    }
  };

  const check = () => run(async () => {
    setLines(await collectPushDiagnostics());
  });
  const localTest = () => run(async () => {
    await showLocalTestNotification();
    return { level: "ok", text: "Notifica locale inviata. Se non la vedi, il telefono blocca le notifiche di questo sito o dell'app." };
  });
  const serverTest = () => run(async () => testPushMessage(await sendTestPush()));
  const reset = () => run(async () => {
    await disablePush();
    await enablePush();
    setLines(await collectPushDiagnostics());
    return { level: "ok", text: "Notifiche reimpostate: questo dispositivo ha una registrazione nuova." };
  });

  return (
    <details className="panel push-diagnostics" onToggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open && !lines) void check(); }}>
      <summary>Non ricevi le notifiche su questo dispositivo?</summary>
      <div className="push-diagnostics__body">
        <p>Controlla in pochi passaggi dove si ferma la notifica. Vale solo per il dispositivo che stai usando adesso.</p>
        {lines && (
          <dl className="push-diagnostics__list">
            {lines.map((line) => (
              <div className={`push-diagnostics__row push-diagnostics__row--${line.level}`} key={line.label}>
                <dt>{line.label}</dt>
                <dd>{line.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {message && (
          <p className={message.level === "ok" ? "push-diagnostics__message" : "form-error"} role="status">{message.text}</p>
        )}
        <div className="push-diagnostics__actions">
          <button className="button button--secondary button--small" type="button" disabled={busy} onClick={() => void check()}>Controlla</button>
          <button className="button button--secondary button--small" type="button" disabled={busy} onClick={() => void localTest()}>Prova locale</button>
          <button className="button button--secondary button--small" type="button" disabled={busy} onClick={() => void serverTest()}>Invia push di prova</button>
          <button className="button button--secondary button--small" type="button" disabled={busy} onClick={() => void reset()}>Reimposta notifiche</button>
        </div>
        <p className="push-diagnostics__hint">
          «Prova locale» mostra una notifica dal telefono stesso: se non compare, il problema è nelle impostazioni del sistema.
          «Invia push di prova» passa dal server e dal servizio push, come le notifiche vere.
        </p>
      </div>
    </details>
  );
}
