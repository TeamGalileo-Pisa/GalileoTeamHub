import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Check, Megaphone, Pencil, Pin, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { useAuth } from "../hooks/useAuth";
import { formatDateTime } from "../lib/dates";
import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  listAreas,
  markAnnouncementRead,
  updateAnnouncement,
} from "../lib/data";
import type { Announcement } from "../types/domain";

const schema = z
  .object({
    title: z.string().trim().min(3, "Inserisci un titolo").max(160),
    body: z.string().trim().min(3, "Inserisci il testo").max(10000),
    allAreas: z.boolean(),
    targetAreaIds: z.array(z.string().uuid()),
    publishedAt: z.string().min(1, "Inserisci la data di pubblicazione"),
    expiresAt: z.string().optional(),
    important: z.boolean(),
    pinned: z.boolean(),
  })
  .refine((value) => value.allAreas || value.targetAreaIds.length > 0, {
    message: "Seleziona almeno un'area",
    path: ["targetAreaIds"],
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
  allAreas: true,
  targetAreaIds: [] as string[],
  publishedAt: localDateTime(),
  expiresAt: "",
  important: false,
  pinned: false,
};

export function AnnouncementsPage() {
  const { access } = useAuth();
  const isAdmin = Boolean(access?.isAdmin);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const announcementsQuery = useQuery({
    queryKey: ["announcements", access?.userId],
    queryFn: listAnnouncements,
  });
  const areasQuery = useQuery({
    queryKey: ["areas"],
    queryFn: listAreas,
    enabled: isAdmin,
  });
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: emptyForm,
  });
  const allAreas = useWatch({ control: form.control, name: "allAreas" });

  useEffect(() => {
    if (!editing) return;
    form.reset({
      title: editing.title,
      body: editing.body,
      allAreas: editing.allAreas,
      targetAreaIds: editing.targetAreaIds,
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

  function stopEditing() {
    setEditing(null);
    form.reset({ ...emptyForm, publishedAt: localDateTime() });
  }

  return (
    <div className="page-container">
      <PageHeader
        eyebrow="Comunicazioni interne"
        title="Bacheca"
        description={
          isAdmin
            ? "Pubblica aggiornamenti per tutte le aree o per destinatari selezionati."
            : "Qui trovi solo le comunicazioni generali o destinate alla tua area."
        }
      />

      {feedback && <div className="form-success page-feedback" role="status">{feedback}</div>}

      {isAdmin && (
        <section className="panel announcement-form-panel">
          <div className="panel__header">
            <div><h2>{editing ? "Modifica comunicazione" : "Nuova comunicazione"}</h2><p>I messaggi restano interni al gestionale e non generano email.</p></div>
            <Megaphone size={20} />
          </div>
          <form className="panel__body form-grid" onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}>
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
              <label className="check-row"><input type="checkbox" {...form.register("allAreas")} /> Tutte le aree</label>
              {!allAreas && (
                <div className="area-checkbox-grid">
                  {areasQuery.data?.filter((area) => area.active).map((area) => (
                    <label className="check-row" key={area.id}>
                      <input type="checkbox" value={area.id} {...form.register("targetAreaIds")} /> {area.name}
                    </label>
                  ))}
                </div>
              )}
              {form.formState.errors.targetAreaIds && <span className="field-error">{form.formState.errors.targetAreaIds.message}</span>}
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
                <span>Destinatari: {announcement.allAreas ? "Tutte le aree" : announcement.targetAreaNames.join(", ")}</span>
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
