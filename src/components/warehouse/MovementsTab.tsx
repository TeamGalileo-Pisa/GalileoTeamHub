import { useMemo, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowDownToLine, History, Plus, RotateCcw } from "lucide-react";
import { Modal } from "../Modal";
import type { InventoryApi } from "../../hooks/useInventory";
import {
  EVENT_LABELS, MOVEMENT_EVENTS, MOVEMENT_TYPES, downloadBlob, formatDate, inventoryErrorMessage, ledgerRows, todayIso, toCsv,
  type InventoryItem, type MovementType,
} from "../../lib/inventory";

export function MovementModal({ api, item, onClose }: { api: InventoryApi; item?: InventoryItem | null; onClose: () => void }) {
  const items = (api.items.data ?? []).filter((candidate) => !candidate.archived_at);
  const locations = api.locations.data ?? [];
  const types = MOVEMENT_TYPES.filter((type) => api.canManage || !type.managerOnly);
  const [draft, setDraft] = useState({
    itemId: item?.id ?? "",
    type: (types.find((type) => type.value === "uscita") ?? types[0]).value as MovementType,
    date: todayIso(), quantity: "1", person: api.operatorName || api.access?.displayName || "", reason: "", toLocationId: "", notes: "",
  });
  const set = (patch: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...patch }));
  const selected = items.find((candidate) => candidate.id === draft.itemId);
  const codeOf = (id: string | null) => locations.find((location) => location.id === id)?.code ?? "—";
  const isMove = draft.type === "spostamento";

  const save = useMutation({
    mutationFn: () => api.write("inventory_record_movement", {
      p_item_id: draft.itemId, p_type: draft.type, p_quantity: isMove ? 0 : Number(draft.quantity), p_person: draft.person, p_reason: draft.reason,
      p_date: draft.date || null, p_to_location_id: isMove ? draft.toLocationId : null, p_notes: draft.notes,
    }),
    onSuccess: onClose,
  });
  const submit = (event: FormEvent) => { event.preventDefault(); save.mutate(); };

  return (
    <Modal title={item ? `Movimento · ${item.sku}` : "Nuovo movimento"} onClose={onClose}>
      <form className="warehouse-form" onSubmit={submit}>
        <label className="form-field warehouse-form__wide">Articolo (SKU e materiale) *
          <select className="input" required value={draft.itemId} onChange={(event) => set({ itemId: event.target.value })} disabled={Boolean(item)}>
            <option value="" disabled>Scegli dall'inventario</option>
            {items.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.sku} · {candidate.name}</option>)}
          </select>
          {selected && <small>Disponibili {selected.quantity} {selected.unit}{selected.on_loan > 0 ? ` · ${selected.on_loan} in prestito` : ""} · Posizione {codeOf(selected.location_id)}</small>}
        </label>
        <label className="form-field">Tipo movimento *
          <select className="input" value={draft.type} onChange={(event) => set({ type: event.target.value as MovementType })}>
            {types.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
          <small>{MOVEMENT_TYPES.find((type) => type.value === draft.type)?.hint}</small>
        </label>
        <label className="form-field">Data *
          <input className="input" type="date" required max={todayIso()} value={draft.date} onChange={(event) => set({ date: event.target.value })} />
        </label>
        {isMove ? (
          <label className="form-field warehouse-form__wide">Nuova posizione *
            <select className="input" required value={draft.toLocationId} onChange={(event) => set({ toLocationId: event.target.value })}>
              <option value="" disabled>Scegli la posizione di arrivo</option>
              {locations.filter((location) => !location.archived_at && location.id !== selected?.location_id).map((location) => <option key={location.id} value={location.id}>{location.code}{location.main_content ? ` · ${location.main_content}` : ""}</option>)}
            </select>
          </label>
        ) : (
          <label className="form-field">Quantità *
            <input className="input" type="number" min={1} max={1000000} step={1} required value={draft.quantity} onChange={(event) => set({ quantity: event.target.value })} />
          </label>
        )}
        <label className="form-field">Persona *
          <input className="input" required minLength={2} maxLength={160} value={draft.person} onChange={(event) => set({ person: event.target.value })} placeholder="Nome di chi effettua il movimento" />
        </label>
        <label className="form-field">Motivo / progetto
          <input className="input" maxLength={500} value={draft.reason} onChange={(event) => set({ reason: event.target.value })} placeholder="Es. Test Rover Kraków" />
        </label>
        <label className="form-field warehouse-form__wide">Note<textarea className="input" rows={2} maxLength={2000} value={draft.notes} onChange={(event) => set({ notes: event.target.value })} /></label>
        {save.error && <p className="form-error warehouse-form__wide" role="alert">{inventoryErrorMessage(save.error)}</p>}
        <div className="form-actions warehouse-form__wide">
          <button className="button button--primary" disabled={save.isPending || !draft.itemId}>{save.isPending ? "Registrazione…" : "Registra movimento"}</button>
          <button className="button button--secondary" type="button" onClick={onClose}>Annulla</button>
        </div>
      </form>
    </Modal>
  );
}

export function MovementsTab({ api }: { api: InventoryApi }) {
  const [creating, setCreating] = useState(false);
  const [showEdits, setShowEdits] = useState(false);
  const [type, setType] = useState("all");
  const [search, setSearch] = useState("");

  const exportAll = useMutation({
    mutationFn: async () => {
      const rows = await api.readLedger();
      downloadBlob(toCsv(ledgerRows(rows)), `registro-magazzino-${todayIso()}.csv`);
      return rows.length;
    },
  });

  const rows = useMemo(() => (api.history.data ?? []).filter((event) => {
    if (!showEdits && !MOVEMENT_EVENTS.has(event.event_type)) return false;
    if (type !== "all" && event.event_type !== type) return false;
    const haystack = `${event.sku_snapshot} ${event.item_name_snapshot} ${event.taken_by_name} ${event.reason} ${event.actor_name}`.toLocaleLowerCase("it");
    return haystack.includes(search.trim().toLocaleLowerCase("it"));
  }), [api.history.data, showEdits, type, search]);

  return (
    <section className="panel panel__body warehouse-section">
      <header className="warehouse-section__header">
        <div><p className="eyebrow">Storico e tracciabilità</p><h2><History size={21} /> Movimenti</h2><p>Ogni prelievo, reso, spostamento o smaltimento va registrato qui per evitare disallineamenti.</p></div>
        <div className="warehouse-history-actions">
          <button className="button button--secondary" type="button" disabled={exportAll.isPending} onClick={() => exportAll.mutate()}><ArrowDownToLine size={16} /> {exportAll.isPending ? "Creo il file…" : "Esporta registro CSV"}</button>
          <button className="button button--primary" type="button" onClick={() => setCreating(true)}><Plus size={16} /> Nuovo movimento</button>
        </div>
      </header>
      {exportAll.isSuccess && <p className="form-success" role="status">Registro completo esportato: {exportAll.data} eventi.</p>}
      {exportAll.error && <p className="form-error" role="alert">{inventoryErrorMessage(exportAll.error)}</p>}
      {api.canManage && api.backupState === "saved" && <p className="form-success" role="status">Copia esterna del registro aggiornata (registro-magazzino.csv).</p>}
      {api.canManage && api.backupState === "error" && <p className="form-error" role="alert">La cronologia nel database è salva, ma la copia CSV esterna non si è aggiornata: {api.backupError}</p>}
      <div className="warehouse-filters">
        <label><span className="sr-only">Tipo di movimento</span>
          <select className="input" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="all">Tutti i tipi</option>
            {MOVEMENT_TYPES.map((entry) => <option key={entry.value} value={{ entrata: "stock_in", uscita: "stock_out", prestito: "loan", rientro: "return", spostamento: "move", smaltimento: "dispose" }[entry.value]}>{entry.label}</option>)}
          </select>
        </label>
        <label className="warehouse-filter-search"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cerca SKU, materiale, persona o progetto" /></label>
        <label className="warehouse-archived-toggle"><input type="checkbox" checked={showEdits} onChange={(event) => setShowEdits(event.target.checked)} /> Mostra anche modifiche e creazioni</label>
        {api.canManage && <button className="button button--secondary button--small" type="button" disabled={api.backupState === "syncing"} onClick={() => void api.syncLedger()}><RotateCcw size={14} /> {api.backupState === "syncing" ? "Aggiorno…" : "Aggiorna copia esterna"}</button>}
      </div>
      {api.history.isLoading ? <p>Caricamento movimenti…</p> : rows.length === 0 ? <p>Nessun movimento registrato.</p> : (
        <div className="warehouse-history-wrap">
          <table className="warehouse-history">
            <thead><tr><th>Data</th><th>SKU</th><th>Materiale</th><th>Tipo</th><th>Quantità</th><th>Persona</th><th>Motivo / progetto</th><th>Posizione</th><th>Registrato da</th></tr></thead>
            <tbody>{rows.map((event) => (
              <tr key={event.id}>
                <td>{formatDate(event.movement_date)}</td>
                <td>{event.sku_snapshot || "—"}</td>
                <td><strong>{event.item_name_snapshot || "—"}</strong><small>{event.warehouse_name_snapshot}</small></td>
                <td><span className={`warehouse-event warehouse-event--${MOVEMENT_EVENTS.has(event.event_type) ? "stock_in" : "edit"}`}>{EVENT_LABELS[event.event_type] ?? event.event_type}</span></td>
                <td>{event.quantity_delta > 0 ? `+${event.quantity_delta}` : event.quantity_delta || "—"}{event.quantity_before !== null && event.quantity_after !== null && event.quantity_delta !== 0 && <small>{event.quantity_before} → {event.quantity_after}</small>}</td>
                <td>{event.taken_by_name || "—"}</td>
                <td>{event.reason || event.notes || "—"}</td>
                <td>{event.from_location_code && event.to_location_code && event.from_location_code !== event.to_location_code ? `${event.from_location_code} → ${event.to_location_code}` : event.to_location_code || event.from_location_code || "—"}</td>
                <td>{event.actor_name}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <p className="warehouse-footnote">Il registro è append-only: non si può modificare né cancellare. Sono mostrati gli ultimi 300 eventi; l'esportazione contiene tutta la cronologia.</p>
      {creating && <MovementModal api={api} onClose={() => setCreating(false)} />}
    </section>
  );
}
