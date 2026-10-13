import { Fragment, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Check, Megaphone } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../hooks/useAuth";
import { listNotifications, markNotificationRead } from "../lib/data";

function safeRoute(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : null;
}

// Toglie dal telefono (barra delle notifiche) il messaggio appena letto.
async function dismissSystemNotification(id: string) {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const shown = (await registration?.getNotifications({ tag: id })) ?? [];
    shown.forEach((item) => item.close());
  } catch {
    /* best effort: la notifica di sistema puo' restare finche' l'utente non la chiude */
  }
}

export function NotificationsPage() {
  const { access } = useAuth();
  const [searchParams] = useSearchParams();
  const selectedId = searchParams.get("notifica");
  const queryClient = useQueryClient();
  const notifications = useQuery({
    queryKey: ["system-notifications", access?.userId],
    queryFn: listNotifications,
    enabled: Boolean(access),
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
  });
  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: async (_data, id) => {
      void dismissSystemNotification(id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["system-notifications", access?.userId] }),
        queryClient.invalidateQueries({ queryKey: ["unread-notifications", access?.userId] }),
      ]);
    },
  });
  const { mutate: markNotificationAsRead, isPending: markingRead } = markRead;

  // Aprendo una notifica (dal telefono o dall'elenco) si vede solo quel messaggio:
  // lo storico completo resta su /notifiche, senza il parametro.
  const thread = useMemo(() => {
    const sorted = [...(notifications.data ?? [])].sort((x, y) => new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime());
    return selectedId ? sorted.filter((item) => item.id === selectedId) : sorted;
  }, [notifications.data, selectedId]);

  useEffect(() => {
    if (!notifications.data) return;
    const selected = selectedId ? notifications.data.find((item) => item.id === selectedId) : null;
    if (selected) {
      document.getElementById(`notification-${selected.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (!selected.readAt && !markingRead) markNotificationAsRead(selected.id);
    } else {
      document.getElementById("chat-end")?.scrollIntoView({ block: "end" });
    }
  }, [selectedId, notifications.data, markingRead, markNotificationAsRead]);

  const dayLabel = (iso: string) =>
    new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));

  return (
    <div className="page-container">
      <PageHeader
        eyebrow="Centro messaggi"
        title="Notifiche"
        description={selectedId
          ? "Messaggio ricevuto: aprendolo lo hai segnato come letto."
          : "I messaggi che ricevi, come in una chat: in basso i più recenti. Aprendo un messaggio lo segni come letto."}
      />
      {notifications.error && <div className="form-error" role="alert">{notifications.error.message}</div>}
      {notifications.isLoading ? (
        <div className="panel table-loading">Caricamento notifiche…</div>
      ) : thread.length ? (
        <section className="chat-thread" aria-label="Messaggi ricevuti" aria-live="polite">
          {thread.map((notification, index) => {
            const announcementId = typeof notification.data.announcement_id === "string"
              ? notification.data.announcement_id
              : null;
            const boardRoute = announcementId
              ? access?.isMember
                ? `/membri?annuncio=${encodeURIComponent(announcementId)}`
                : access?.isAdmin
                  ? `/admin/bacheca?annuncio=${encodeURIComponent(announcementId)}`
                  : `/area/bacheca?annuncio=${encodeURIComponent(announcementId)}`
              : null;
            const destination = boardRoute ?? safeRoute(notification.data.route);
            const selected = notification.id === selectedId;
            const newDay = index === 0 || dayLabel(thread[index - 1].createdAt) !== dayLabel(notification.createdAt);
            return (
              <Fragment key={notification.id}>
                {newDay && <p className="chat-day">{dayLabel(notification.createdAt)}</p>}
                <article
                  className={`chat-bubble ${notification.readAt ? "" : "chat-bubble--unread"} ${selected ? "chat-bubble--selected" : ""}`}
                  id={`notification-${notification.id}`}
                >
                  <h2 className="chat-bubble__title">{notification.title}</h2>
                  <p className="chat-bubble__body">{notification.body}</p>
                  {(destination || !notification.readAt) && (
                    <div className="chat-bubble__actions">
                      {destination && <Link className="button button--secondary button--small" to={destination}>
                        <Megaphone size={15} /> {announcementId ? "Apri in Bacheca" : "Apri sezione"}
                      </Link>}
                      {!notification.readAt && <button
                        className="button button--secondary button--small"
                        type="button"
                        disabled={markRead.isPending}
                        onClick={() => markRead.mutate(notification.id)}
                      ><Check size={15} /> Segna come letto</button>}
                    </div>
                  )}
                  <time className="chat-bubble__time" dateTime={notification.createdAt}>
                    {new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" }).format(new Date(notification.createdAt))}
                    {notification.readAt ? " ✓✓" : ""}
                  </time>
                </article>
              </Fragment>
            );
          })}
          <div id="chat-end" />
        </section>
      ) : (
        <div className="panel panel__body"><EmptyState
          icon={BellRing}
          title={selectedId ? "Messaggio non disponibile" : "Nessuna notifica"}
          description={selectedId
            ? "Questo messaggio non è più tra le tue notifiche recenti."
            : "Quando riceverai un aggiornamento, lo troverai qui come messaggio."}
        /></div>
      )}
      {selectedId && (
        <div className="chat-bubble__actions">
          <Link className="button button--secondary button--small" to="/notifiche">Vedi tutte le notifiche</Link>
        </div>
      )}
    </div>
  );
}
