import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Check, Megaphone, Pencil, Pin, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { useAuth } from "../hooks/useAuth";
import { supportsPushNotifications } from "../lib/push";
import { formatDateTime } from "../lib/dates";
import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  listAnnouncementLeads,
  listAreas,
  listNotifications,
  markNotificationRead,
  markAnnouncementRead,
  updateAnnouncement,
} from "../lib/data";
import type { Announcement } from "../types/domain";

const schema = z
  .object({
    title: z.string().trim().min(3, "Inserisci un titolo").max(160),
    body: z.string().trim().min(3, "Inserisci il testo").max(10000),
    allAreas: z.boolean(),
    allAreaLeads: z.boolean(),
    targetMembers: z.boolean(),
    targetAreaIds: z.array(z.string().uuid()),
    targetLeadIds: z.array(z.string().uuid()),
    publishedAt: z.string().min(1, "Inserisci la data di pubblicazione"),
    expiresAt: z.string().optional(),
    important: z.boolean(),
    pinned: z.boolean(),
  })
  .refine(
    (value) =>
      !value.expiresAt || new Date(value.expiresAt) > new Date(value.publishedAt),
    { message: "La scadenza deve essere successiva alla pubblicazione", path: ["expiresAt"] },
  );

function localDateTime(value = new Date().toISOString()): string {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

const emptyForm = {
  title: "",
  body: "",
  allAreas: false,
  allAreaLeads: false,
  targetMembers: false,
  targetAreaIds: [] as string[],
  targetLeadIds: [] as string[],
  publishedAt: localDateTime(),
  expiresAt: "",
  important: false,
  pinned: false,
};

export function AnnouncementsPage() {
  const { access } = useAuth();
  const isAdmin = Boolean(access?.isAdmin);
  const isTeamLeader = Boolean(access?.isTeamLeader);
  const isAreaLead = Boolean(access && !access.isAdmin && !access.isMember);
  const showSystemNotifications = supportsPushNotifications();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const notificationsQuery = useQuery({
    queryKey: ["system-notifications", access?.userId],
    queryFn: listNotifications,
    enabled: Boolean(access && showSystemNotifications),
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
  });
  const announcementNotifications = notificationsQuery.data ?? [];

  const announcementsQuery = useQuery({
    queryKey: ["announcements", access?.userId],
    queryFn: listAnnouncements,
  });
  const areasQuery = useQuery({
    queryKey: ["areas"],
    queryFn: listAreas,
    enabled: isAdmin,
  });
  const leadsQuery = useQuery({
    queryKey: ["announcement-leads"],
    queryFn: listAnnouncementLeads,
    enabled: isAdmin,
  });
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: emptyForm,
  });
  const allAreas = useWatch({ control: form.control, name: "allAreas" });
  const allAreaLeads = useWatch({ control: form.control, name: "allAreaLeads" });
  const targetMembers = useWatch({ control: form.control, name: "targetMembers" });

  useEffect(() => {
    if (!editing) return;
    form.reset({
      title: editing.title,
      body: editing.body,
      allAreas: editing.allAreas,
      allAreaLeads: editing.allAreaLeads,
      targetMembers: editing.targetMembers || editing.targetAreaIds.length > 0,
      targetAreaIds: editing.targetAreaIds,
      targetLeadIds: editing.targetLeadIds,
      publishedAt: localDateTime(editing.publishedAt),
      expiresAt: editing.expiresAt ? localDateTime(editing.expiresAt) : "",
      important: editing.important,
      pinned: editing.pinned,
    });
  }, [editing, form]);

  const saveMutation = useMutation({
    mutationFn: (values: z.infer<typeof schema>) =>
      editing
        ? updateAnnouncement({ id: editing.id, ...values })
        : createAnnouncement(values),
    onMutate: () => setFeedback(null),
    onSuccess: async () => {
      setFeedback(editing ? "Comunicazione aggiornata." : "Comunicazione pubblicata.");
      setEditing(null);
      form.reset({ ...emptyForm, publishedAt: localDateTime() });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["announcements"] }),
        queryClient.invalidateQueries({ queryKey: ["unread-announcements"] }),
      ]);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteAnnouncement,
    onMutate: () => setFeedback(null),
    onSuccess: async () => {
      setFeedback("Comunicazione eliminata.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["announcements"] }),
        queryClient.invalidateQueries({ queryKey: ["unread-announcements"] }),
      ]);
    },
  });
  const readMutation = useMutation({
    mutationFn: ({ id, read }: { id: string; read: boolean }) =>
      markAnnouncementRead(id, read),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["announcements"] }),
        queryClient.invalidateQueries({ queryKey: ["unread-announcements"] }),
      ]);
    },
  });

  const notificationReadMutation = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["system-notifications"] });
      await queryClient.invalidateQueries({ queryKey: ["unread-notifications"] });
    },
  });

  function stopEditing() {
    setEditing(null);
    form.reset({ ...emptyForm, publishedAt: localDateTime() });
  }

  function submitAnnouncement(values: z.infer<typeof schema>) {
    const ownAreaIds = access?.areas.map((area) => area.id) ?? [];
    const preserveHistoricBroadcast = Boolean(editing?.allAreas && isAdmin && !isTeamLeader);
    const normalized = {
      ...values,
      allAreas: isTeamLeader ? values.allAreas : preserveHistoricBroadcast,
      allAreaLeads: isAreaLead || values.allAreas ? false : values.allAreaLeads,
      targetMembers: values.allAreas ? false : isAreaLead || (isTeamLeader && values.targetMembers),
      targetAreaIds: values.allAreas ? [] : isAreaLead ? ownAreaIds : isTeamLeader && values.targetMembers ? values.targetAreaIds : [],
      targetLeadIds: isAreaLead || values.allAreas || values.allAreaLeads ? [] : values.targetLeadIds,
    };
    const hasRecipients = normalized.allAreas || normalized.allAreaLeads ||
      normalized.targetLeadIds.length > 0 ||
      (normalized.targetMembers && normalized.targetAreaIds.length > 0);
    if (!hasRecipients) {
      form.setError("root", { message: "Scegli almeno un destinatario prima di pubblicare." });
      return;
    }
    form.clearErrors("root");
    saveMutation.mutate(normalized);
  }

  return (
    <div className="page-container">
      <PageHeader
        eyebrow="Comunicazioni interne"
        title="Bacheca"
        description={
          isTeamLeader
            ? "Scegli i Capi Area, i membri per area o entrambi. Puoi anche inviare una comunicazione a tutto il team."
            : isAdmin
              ? "Invia comunicazioni ai Capi Area selezionati oppure a tutti."
              : isAreaLead
                ? "Puoi scrivere ai membri delle tue aree. Gli altri destinatari non sono accessibili."
                : "Qui trovi le comunicazioni destinate alla tua area."
        }
      />

      {feedback && <div className="form-success page-feedback" role="status">{feedback}</div>}

      {showSystemNotifications && announcementNotifications.length > 0 && (
        <section className="panel notifications-panel" aria-labelledby="system-notifications-title">
          <div className="panel__header">
            <div>
              <h2 id="system-notifications-title">Notifiche di sistema</h2>
              <p>Nuove candidature, prenotazioni, modifiche e comunicazioni importanti.</p>
            </div>
            <BellRing size={20} />
          </div>
          <div className="notifications-list">
            {announcementNotifications.slice(0, 12).map((notification) => (
              <article className={`notification-item ${notification.readAt ? "" : "notification-item--new"}`} key={notification.id}>
                <div className="notification-item__icon"><BellRing size={16} /></div>
                <div className="notification-item__content">
                  <strong>{notification.title}</strong>
                  <p>{notification.body}</p>
                  <time>{formatDateTime(notification.createdAt)}</time>
                </div>
                {typeof notification.data.route === "string" && notification.data.route.startsWith("/") && !notification.data.route.startsWith("//") && (
                  <Link className="button button--secondary button--small" to={notification.data.route}>
                    {notification.type === "application.received" ? "Apri candidatura" : "Apri"}
                  </Link>
                )}
                {!notification.readAt && (
                  <button
                    className="button button--secondary button--small"
                    type="button"
                    disabled={notificationReadMutation.isPending}
                    onClick={() => notificationReadMutation.mutate(notification.id)}
                  >
                    Segna letto
                  </button>
                )}
              </article>
            ))}
          </div>
        </section>
      )}



      {(isAdmin || isAreaLead) && (
        <section className="panel announcement-form-panel">
          <div className="panel__header">
            <div><h2>{editing ? "Modifica comunicazione" : "Nuova comunicazione"}</h2><p>Comunicazione interna: riceveranno una notifica gli account selezionati.</p></div>
            <Megaphone size={20} />
          </div>
          <form className="panel__body form-grid" onSubmit={form.handleSubmit(submitAnnouncement)}>
            <div className="form-field form-field--full">
              <label htmlFor="announcement-title">Titolo</label>
              <input id="announcement-title" className="input" {...form.register("title")} />
              {form.formState.errors.title && <span className="field-error">{form.formState.errors.title.message}</span>}
            </div>
            <div className="form-field form-field--full">
              <label htmlFor="announcement-body">Testo</label>
              <textarea id="announcement-body" className="textarea" rows={5} {...form.register("body")} />
              {form.formState.errors.body && <span className="field-error">{form.formState.errors.body.message}</span>}
            </div>
            <div className="form-field form-field--full">
              <fieldset className="audience-picker">
                <legend>Destinatari</legend>
                {isAreaLead ? (
                  <div className="info-callout">Questo messaggio sarà inviato solo ai membri di: {access?.areas.map((area) => area.name).join(", ") || "nessuna area attiva"}.</div>
                ) : (
                  <>
                    {isTeamLeader && (
                      <label className="check-row audience-option">
                        <input type="checkbox" {...form.register("allAreas")} />
                        <span><strong>Tutti i membri e tutti i Capi Area</strong><small>Invia a tutto il team.</small></span>
                      </label>
                    )}
                    {!allAreas && (
                      <>
                        {isAdmin && (
                          <>
                            <label className="check-row audience-option">
                              <input type="checkbox" {...form.register("allAreaLeads")} />
                              <span><strong>Tutti i Capi Area</strong><small>Se non selezioni questa opzione, puoi scegliere i destinatari uno per uno.</small></span>
                            </label>
                            {!allAreaLeads && (
                              <div className="audience-checklist" aria-label="Seleziona i Capi Area">
                                {leadsQuery.data?.map((lead) => (
                                  <label className="check-row" key={lead.userId}>
                                    <input type="checkbox" value={lead.userId} {...form.register("targetLeadIds")} />
                                    <span>{lead.displayName}<small>{lead.areaName}</small></span>
                                  </label>
                                ))}
                                {leadsQuery.isLoading && <p role="status">Caricamento Capi Area…</p>}
                                {leadsQuery.error && <p className="field-error" role="alert">Non riesco a caricare i Capi Area. Riprova tra poco.</p>}
                                {!leadsQuery.isLoading && !leadsQuery.error && !leadsQuery.data?.length && <p>Nessun Capo Area attivo disponibile.</p>}
                              </div>
                            )}
                          </>
                        )}
                        {isTeamLeader && (
                          <>
                            <label className="check-row audience-option audience-option--spaced">
                              <input type="checkbox" {...form.register("targetMembers")} />
                              <span><strong>Includi i membri</strong><small>Scegli una o più aree; puoi combinarle con i Capi Area selezionati sopra.</small></span>
                            </label>
                            {targetMembers && (
                              <div className="audience-checklist" aria-label="Seleziona le aree dei membri">
                                <button className="button button--secondary button--small" type="button" onClick={() => form.setValue("targetAreaIds", areasQuery.data?.filter((area) => area.active).map((area) => area.id) ?? [], { shouldDirty: true })}>Seleziona tutte le aree</button>
                                {areasQuery.data?.filter((area) => area.active).map((area) => (
                                  <label className="check-row" key={area.id}>
                                    <input type="checkbox" value={area.id} {...form.register("targetAreaIds")} />
                                    <span>{area.name}</span>
                                  </label>
                                ))}
                                {areasQuery.isLoading && <p role="status">Caricamento aree…</p>}
                              </div>
                            )}
                          </>
                        )}
                      </>
                    )}
                    {editing?.allAreas && !isTeamLeader && <div className="info-callout">Questa comunicazione storica raggiungeva tutti i destinatari. Puoi aggiornarne il testo mantenendo lo stesso pubblico.</div>}
                  </>
                )}
              </fieldset>
              {form.formState.errors.root && <span className="field-error">{form.formState.errors.root.message}</span>}
            </div>
            <div className="form-field">
              <label htmlFor="announcement-published">Pubblicazione</label>
              <input id="announcement-published" className="input" type="datetime-local" {...form.register("publishedAt")} />
            </div>
            <div className="form-field">
              <label htmlFor="announcement-expires">Scadenza facoltativa</label>
              <input id="announcement-expires" className="input" type="datetime-local" {...form.register("expiresAt")} />
              {form.formState.errors.expiresAt && <span className="field-error">{form.formState.errors.expiresAt.message}</span>}
            </div>
            <div className="form-field form-field--full announcement-flags">
              <label className="check-row"><input type="checkbox" {...form.register("important")} /> Importante</label>
              <label className="check-row"><input type="checkbox" {...form.register("pinned")} /> In evidenza</label>
            </div>
            {saveMutation.error && <div className="form-error form-field--full" role="alert">{saveMutation.error.message}</div>}
            <div className="form-actions">
              {editing && <button className="button button--secondary" type="button" onClick={stopEditing}>Annulla modifica</button>}
              <button className="button button--primary" type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Salvataggio…" : editing ? "Salva modifiche" : "Pubblica"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="announcement-list" aria-live="polite">
        {announcementsQuery.isLoading ? (
          <div className="panel table-loading">Caricamento comunicazioni…</div>
        ) : announcementsQuery.error ? (
          <div className="form-error" role="alert">{announcementsQuery.error.message}</div>
        ) : announcementsQuery.data?.length ? (
          announcementsQuery.data.map((announcement) => {
            const adminState = announcement.isActive
              ? "Attiva"
                : new Date(announcement.publishedAt) > new Date()
                  ? "Programmata"
                  : "Scaduta";
            const audience = announcement.allAreas
              ? "Tutti i membri e tutti i Capi Area"
              : [
                  announcement.targetMembers && announcement.targetAreaNames.length
                    ? `Membri: ${announcement.targetAreaNames.join(", ")}`
                    : "",
                  announcement.allAreaLeads
                    ? "Tutti i Capi Area"
                    : announcement.targetLeadNames.length
                      ? `Capi Area: ${announcement.targetLeadNames.join(", ")}`
                      : announcement.targetAreaLeads && announcement.targetAreaNames.length
                        ? `Capi Area: ${announcement.targetAreaNames.join(", ")}`
                        : announcement.targetLeadIds.length
                          ? "Capi Area selezionati"
                          : "",
                ].filter(Boolean).join(" · ") || "Destinatari selezionati";
            return (
            <article className={`panel announcement-card ${!announcement.isRead && !isAdmin ? "announcement-card--new" : ""}`} key={announcement.id}>
              <div className="announcement-card__meta">
                <div className="badge-row">
                  {announcement.pinned && <StatusBadge label="In evidenza" tone="info" />}
                  {announcement.important && <StatusBadge label="Importante" tone="warning" />}
                  {!isAdmin && <StatusBadge label={announcement.isRead ? "Letto" : "Nuovo"} tone={announcement.isRead ? "neutral" : "success"} />}
                  {isAdmin && <StatusBadge label={adminState} tone={announcement.isActive ? "success" : "neutral"} />}
                </div>
                <time>{formatDateTime(announcement.publishedAt)}</time>
              </div>
              <div className="announcement-card__title">
                {announcement.pinned ? <Pin size={18} /> : <BellRing size={18} />}
                <h2>{announcement.title}</h2>
              </div>
              <p className="announcement-card__body">{announcement.body}</p>
              <div className="announcement-card__details">
                <span>Destinatari: {audience}</span>
                {announcement.expiresAt && <span>Scadenza: {formatDateTime(announcement.expiresAt)}</span>}
                {isAdmin && <span>Letture area: {announcement.readCount}</span>}
              </div>
              <div className="announcement-card__actions">
                {isAdmin ? (
                  <>
                    <button className="button button--secondary button--small" type="button" onClick={() => setEditing(announcement)}><Pencil size={15} /> Modifica</button>
                    <button className="button button--danger button--small" type="button" disabled={deleteMutation.isPending} onClick={() => { if (window.confirm("Eliminare definitivamente questa comunicazione?")) deleteMutation.mutate(announcement.id); }}><Trash2 size={15} /> Elimina</button>
                  </>
                ) : (
                  <button className="button button--secondary button--small" type="button" disabled={readMutation.isPending} onClick={() => readMutation.mutate({ id: announcement.id, read: !announcement.isRead })}>
                    <Check size={15} /> {announcement.isRead ? "Segna come nuovo" : "Segna come letto"}
                  </button>
                )}
              </div>
            </article>
            );
          })
        ) : (
          <div className="panel"><EmptyState icon={Megaphone} title="Nessuna comunicazione" description={isAdmin ? "Pubblica il primo aggiornamento per le aree." : "Non ci sono nuove comunicazioni per la tua area."} /></div>
        )}
      </section>
    </div>
  );
}

