import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmDialog, Modal } from "./Modal";
import { rpc, staffAction } from "../lib/operations";
import type {
  AreaRecord,
  RecruitmentCampaign,
  StaffMember,
} from "../types/domain";

export function AreaEditor({
  area,
  onClose,
}: {
  area: AreaRecord;
  onClose: () => void;
}) {
  const cache = useQueryClient();
  const [name, setName] = useState(area.name);
  const [slug, setSlug] = useState(area.slug);
  const [active, setActive] = useState(area.active);
  const [deleting, setDeleting] = useState(false);
  const mutation = useMutation({
    mutationFn: (remove: boolean) =>
      rpc("manage_area", {
        p_id: area.id,
        p_name: name,
        p_slug: slug,
        p_active: active,
        p_delete: remove,
      }),
    onSuccess: async () => {
      await cache.invalidateQueries();
      onClose();
    },
  });
  return (
    <Modal title={"Modifica area · " + area.name} onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate(false);
        }}
      >
        <label className="form-field">
          Nome
          <input
            className="input"
            required
            minLength={2}
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="form-field">
          Identificativo (slug)
          <input
            className="input"
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
        </label>
        <label className="form-field">
          <span>
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />{" "}
            Area attiva
          </span>
        </label>
        <p className="field-help form-field--full">
          Disattivare blocca nuove operazioni dell’area e conserva account,
          appuntamenti e storico. Per riattivarla seleziona di nuovo Area
          attiva.
        </p>
        <Feedback error={mutation.error} />
        <div className="form-actions">
          <button
            className="button button--primary"
            disabled={mutation.isPending}
          >
            Salva modifiche
          </button>
          <button
            className="button button--danger"
            type="button"
            disabled={mutation.isPending}
            onClick={() => setDeleting(true)}
          >
            Elimina se mai utilizzata
          </button>
        </div>
      </form>
      {deleting && (
        <ConfirmDialog
          title={"Eliminare " + area.name + "?"}
          description="L’eliminazione definitiva è possibile soltanto se non ci sono record collegati. Se c’è uno storico usa Disattiva."
          pending={mutation.isPending}
          error={mutation.error?.message}
          onClose={() => setDeleting(false)}
          onConfirm={() => mutation.mutate(true)}
        />
      )}
    </Modal>
  );
}
export function CampaignEditor({
  campaign,
  onClose,
}: {
  campaign: RecruitmentCampaign;
  onClose: () => void;
}) {
  const cache = useQueryClient();
  const [name, setName] = useState(campaign.name);
  const [start, setStart] = useState(campaign.startsOn ?? "");
  const [end, setEnd] = useState(campaign.endsOn ?? "");
  const [status, setStatus] = useState(campaign.status);
  const [deleting, setDeleting] = useState(false);
  const mutation = useMutation({
    mutationFn: (remove: boolean) =>
      rpc("manage_campaign", {
        p_id: campaign.id,
        p_name: name,
        p_starts_on: start || null,
        p_ends_on: end || null,
        p_status: status,
        p_delete: remove,
      }),
    onSuccess: async () => {
      await cache.invalidateQueries();
      onClose();
    },
  });
  return (
    <Modal title={"Modifica recruitment · " + campaign.name} onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate(false);
        }}
      >
        <label className="form-field form-field--full">
          Nome
          <input
            className="input"
            required
            minLength={4}
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="form-field">
          Data iniziale
          <input
            className="input"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className="form-field">
          Data finale
          <input
            className="input"
            type="date"
            min={start}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <label className="form-field">
          Stato
          <select
            className="select"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            {campaign.status === "draft" && (
              <option value="draft">Bozza</option>
            )}
            <option value="active">Attiva</option>
            <option value="archived">Chiudi / Archivia</option>
          </select>
        </label>
        <p className="field-help form-field--full">
          L’archiviazione revoca i link e impedisce nuove prenotazioni; gli
          appuntamenti esistenti restano consultabili e confermati. Le date non
          possono escludere fasce già assegnate.
        </p>
        <Feedback error={mutation.error} />
        <div className="form-actions">
          <button
            className="button button--primary"
            disabled={mutation.isPending}
          >
            Salva modifiche
          </button>
          <button
            className="button button--danger"
            type="button"
            disabled={mutation.isPending || campaign.status !== "draft"}
            onClick={() => setDeleting(true)}
          >
            Elimina bozza inutilizzata
          </button>
        </div>
      </form>
      {deleting && (
        <ConfirmDialog
          title="Eliminare la bozza?"
          description="La campagna viene eliminata definitivamente solo se non ha dati dipendenti."
          pending={mutation.isPending}
          error={mutation.error?.message}
          onClose={() => setDeleting(false)}
          onConfirm={() => mutation.mutate(true)}
        />
      )}
    </Modal>
  );
}
export function StaffEditor({
  member,
  areas,
  onClose,
}: {
  member: StaffMember;
  areas: AreaRecord[];
  onClose: () => void;
}) {
  const cache = useQueryClient();
  const [username, setUsername] = useState(member.username);
  const [displayName, setDisplayName] = useState(member.displayName);
  const [isAdmin, setIsAdmin] = useState(member.isAdmin);
  const [areaId, setAreaId] = useState(member.areas[0]?.id ?? "");
  const [status, setStatus] = useState(member.status);
  const [confirm, setConfirm] = useState<"reset_password" | "delete" | null>(
    null,
  );
  const mutation = useMutation({
    mutationFn: (action: "update" | "reset_password" | "delete") =>
      staffAction({
        action,
        id: member.id,
        ...(action === "update"
          ? {
              username,
              displayName,
              isAdmin,
              areaId: areaId || undefined,
              status,
            }
          : {}),
      }),
    onSuccess: async () => {
      await cache.invalidateQueries();
      onClose();
    },
  });
  return (
    <Modal
      title={"Gestisci account · " + member.username}
      onClose={() => {
        if (!mutation.isPending) onClose();
      }}
    >
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate("update");
        }}
      >
        <label className="form-field">
          Username
          <input
            className="input"
            required
            pattern="[A-Za-z0-9][A-Za-z0-9._-]{1,48}[A-Za-z0-9]"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="form-field">
          Nome visualizzato
          <input
            className="input"
            required
            minLength={2}
            maxLength={120}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
        <label className="form-field">
          Ruolo
          <select
            className="select"
            value={isAdmin ? "admin" : "area_lead"}
            onChange={(e) => setIsAdmin(e.target.value === "admin")}
          >
            <option value="admin">Amministrazione globale</option>
            <option value="area_lead">Capo Area</option>
          </select>
        </label>
        <label className="form-field">
          Area
          <select
            className="select"
            required={!isAdmin}
            disabled={isAdmin}
            value={areaId}
            onChange={(e) => setAreaId(e.target.value)}
          >
            <option value="">Seleziona area</option>
            {areas
              .filter((a) => a.active || a.id === areaId)
              .map((a) => (
                <option value={a.id} key={a.id}>
                  {a.name}
                  {!a.active ? " (disattivata)" : ""}
                </option>
              ))}
          </select>
        </label>
        <label className="form-field">
          Stato
          <select
            className="select"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            <option value="active">Attivo</option>
            <option value="disabled">Disattivato</option>
          </select>
        </label>
        <p className="field-help form-field--full">
          Deve rimanere almeno un amministratore attivo. Gli account con storico
          si disattivano: non vengono eliminati.
        </p>
        <Feedback error={mutation.error} />
        <div className="form-actions">
          <button
            className="button button--primary"
            disabled={mutation.isPending}
          >
            Salva modifiche
          </button>
          <button
            className="button button--secondary"
            type="button"
            disabled={mutation.isPending}
            onClick={() => setConfirm("reset_password")}
          >
            Reimposta password
          </button>
          <button
            className="button button--danger"
            type="button"
            disabled={mutation.isPending}
            onClick={() => setConfirm("delete")}
          >
            Elimina se sicuro
          </button>
        </div>
      </form>
      {confirm && (
        <ConfirmDialog
          title={
            confirm === "reset_password"
              ? `Vuoi reimpostare la password di ${member.username}?`
              : `Eliminare l’account ${member.username}?`
          }
          description={
            confirm === "reset_password"
              ? "Verrà applicata la regola iniziale configurata sul server. Al prossimo accesso sarà obbligatorio scegliere una nuova password. Il reset usa lo username già salvato."
              : "L’operazione è definitiva ed è consentita soltanto senza storico. Altrimenti disattiva l’account."
          }
          pending={mutation.isPending}
          error={mutation.error?.message}
          onClose={() => setConfirm(null)}
          onConfirm={() => mutation.mutate(confirm)}
        />
      )}
    </Modal>
  );
}
function Feedback({ error }: { error: Error | null }) {
  return error ? (
    <p className="form-error form-field--full" role="alert">
      {error.message}
    </p>
  ) : null;
}
