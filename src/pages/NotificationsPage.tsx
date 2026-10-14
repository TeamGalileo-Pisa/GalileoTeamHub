import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Check, Megaphone } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../hooks/useAuth";
import { formatDateTime } from "../lib/dates";
import { listNotifications, markNotificationRead } from "../lib/data";

function safeRoute(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : null;
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
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["system-notifications", access?.userId] }),
        queryClient.invalidateQueries({ queryKey: ["unread-notifications", access?.userId] }),
      ]);
    },
  });
  const { mutate: markNotificationAsRead, isPending: markingRead } = markRead;

  useEffect(() => {
    if (!selectedId || !notifications.data) return;
    const selected = notifications.data.find((item) => item.id === selectedId);
    if (!selected) return;
    document.getElementById(`notification-${selected.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (!selected.readAt && !markingRead) markNotificationAsRead(selected.id);
  }, [selectedId, notifications.data, markingRead, markNotificationAsRead]);

  return (
    <div className="page-container">
      <PageHeader
        eyebrow="Centro messaggi"
        title="Notifiche"
        description="Qui trovi il testo completo delle comunicazioni e degli aggiornamenti ricevuti. Aprendo una notifica la contrassegni come letta."
      />
      {notifications.error && <div className="form-error" role="alert">{notifications.error.message}</div>}
      {notifications.isLoading ? (
        <div className="panel table-loading">Caricamento notifiche…</div>
      ) : notifications.data?.length ? (
        <section className="notifications-list notifications-page-list" aria-label="Messaggi ricevuti" aria-live="polite">
          {notifications.data.map((notification) => {
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
            return (
              <article
                className={`panel notification-message ${notification.readAt ? "" : "notification-message--unread"} ${selected ? "notification-message--selected" : ""}`}
                id={`notification-${notification.id}`}
                key={notification.id}
              >
                <div className="notification-message__header">
                  <span className="notification-message__icon"><BellRing size={18} /></span>
                  <div className="notification-message__heading">
                    <h2>{notification.title}</h2>
                    <time>{formatDateTime(notification.createdAt)}</time>
                  </div>
                  {!notification.readAt && <span className="notification-unread-label">Nuova</span>}
                </div>
                <p className="notification-message__body">{notification.body}</p>
                <div className="notification-message__actions">
                  {destination && <Link className="button button--secondary button--small" to={destination}>
                    <Megaphone size={15} /> {announcementId ? "Apri messaggio in Bacheca" : "Apri sezione"}
                  </Link>}
                  {!notification.readAt && <button
                    className="button button--secondary button--small"
                    type="button"
                    disabled={markRead.isPending}
                    onClick={() => markRead.mutate(notification.id)}
                  ><Check size={15} /> Segna come letto</button>}
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <div className="panel panel__body"><EmptyState icon={BellRing} title="Nessuna notifica" description="Quando riceverai un aggiornamento, troverai qui il messaggio completo." /></div>
      )}
    </div>
  );
}

