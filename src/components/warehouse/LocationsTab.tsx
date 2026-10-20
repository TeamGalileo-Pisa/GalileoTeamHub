import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Archive, MapPin, Pencil, Plus, RotateCcw, Save, Warehouse as WarehouseIcon } from "lucide-react";
import { Modal } from "../Modal";
import { supabase } from "../../lib/supabase";
import type { InventoryApi } from "../../hooks/useInventory";
import { inventoryErrorMessage, validateLocationCode, type InventoryLocation, type InventorySettings, type Warehouse } from "../../lib/inventory";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const DEFAULT_LIMITS: InventorySettings = { shelf_max_letter: "Z", level_max: 99, slot_letters: LETTERS.join(""), slot_max: 99 };

function WarehouseModal({ api, warehouse, onClose }: { api: InventoryApi; warehouse: Warehouse | null; onClose: () => void }) {
  const [draft, setDraft] = useState({ name: warehouse?.name ?? "", location: warehouse?.location ?? "", notes: warehouse?.notes ?? "" });
  const save = useMutation({
    mutationFn: () => warehouse
      ? api.write("inventory_update_warehouse", { p_id: warehouse.id, p_name: draft.name, p_location: draft.location, p_notes: draft.notes })
      : api.write("inventory_create_warehouse", { p_name: draft.name, p_location: draft.location, p_notes: draft.notes }),
    onSuccess: onClose,
  });
  return (
    <Modal title={warehouse ? "Modifica area magazzino" : "Nuova area magazzino"} onClose={onClose}>
      <form className="warehouse-form" onSubmit={(event: FormEvent) => { event.preventDefault(); save.mutate(); }}>
        <label className="form-field">Nome *<input className="input" required minLength={2} maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Es. Magazzino tecnico, Laboratorio analisi" /></label>
        <label className="form-field">Sede<input className="input" maxLength={240} value={draft.location} onChange={(event) => setDraft({ ...draft, location: event.target.value })} placeholder="Edificio, stanza" /></label>
        <label className="form-field warehouse-form__wide">Note<textarea className="input" rows={2} maxLength={2000} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
        {save.error && <p className="form-error warehouse-form__wide" role="alert">{inventoryErrorMessage(save.error)}</p>}
        <div className="form-actions warehouse-form__wide"><button className="button button--primary" disabled={save.isPending}>{save.isPending ? "Salvataggio…" : "Salva"}</button><button className="button button--secondary" type="button" onClick={onClose}>Annulla</button></div>
      </form>
    </Modal>
  );
}

function LocationModal({ api, location, limits, onClose }: { api: InventoryApi; location: InventoryLocation | null; limits: InventorySettings; onClose: () => void }) {
  const warehouses = (api.warehouses.data ?? []).filter((warehouse) => !warehouse.archived_at || warehouse.id === location?.warehouse_id);
  const [draft, setDraft] = useState({
    warehouseId: location?.warehouse_id ?? warehouses[0]?.id ?? "", code: location?.code ?? "", shelf: location?.shelf_label ?? "", level: location?.level_label ?? "",
    box: location?.box_label ?? "", content: location?.main_content ?? "", notes: location?.notes ?? "",
  });
  const code = draft.code.trim().toUpperCase();
  const problem = code ? validateLocationCode(code, limits) : null;
  const changeCode = (value: string) => {
    const next = value.toUpperCase();
    const parsed = /^([A-Z])-(\d{2})-([A-Z])(\d{2})$/.exec(next);
    // Precompila i campi descrittivi dal codice se sono ancora vuoti.
    setDraft((current) => ({
      ...current, code: next,
      shelf: current.shelf || (parsed ? `Scaffale ${parsed[1]}` : ""),
      level: current.level || (parsed ? String(Number(parsed[2])) : ""),
      box: current.box || (parsed ? `Box ${Number(parsed[4])}` : ""),
    }));
  };
  const save = useMutation({
    mutationFn: () => api.write("inventory_save_location", {
      p_id: location?.id ?? null, p_warehouse_id: draft.warehouseId, p_code: code, p_shelf_label: draft.shelf, p_level_label: draft.level,
      p_box_label: draft.box, p_main_content: draft.content, p_notes: draft.notes,
    }),
    onSuccess: onClose,
  });
  return (
    <Modal title={location ? `Modifica posizione ${location.code}` : "Nuova posizione"} onClose={onClose}>
      <form className="warehouse-form" onSubmit={(event: FormEvent) => { event.preventDefault(); if (!problem) save.mutate(); }}>
        <label className="form-field">Codice posizione *
          <input className="input" required maxLength={8} value={draft.code} onChange={(event) => changeCode(event.target.value)} placeholder="A-01-B01" aria-invalid={Boolean(problem)} />
          <small>{problem ?? "Formato [Scaffale]-[Ripiano]-[Box], ad esempio A-01-B01."}</small>
        </label>
        <label className="form-field">Area magazzino *
          <select className="input" required value={draft.warehouseId} onChange={(event) => setDraft({ ...draft, warehouseId: event.target.value })}>
            <option value="" disabled>Scegli l'area</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </select>
        </label>
        <label className="form-field">Scaffale / armadio<input className="input" maxLength={80} value={draft.shelf} onChange={(event) => setDraft({ ...draft, shelf: event.target.value })} /></label>
        <label className="form-field">Ripiano<input className="input" maxLength={80} value={draft.level} onChange={(event) => setDraft({ ...draft, level: event.target.value })} /></label>
        <label className="form-field">Box / cassetto<input className="input" maxLength={80} value={draft.box} onChange={(event) => setDraft({ ...draft, box: event.target.value })} /></label>
        <label className="form-field">Contenuto principale<input className="input" maxLength={160} value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} placeholder="Es. Elettronica" /></label>
        <label className="form-field warehouse-form__wide">Note<textarea className="input" rows={2} maxLength={1000} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
        {save.error && <p className="form-error warehouse-form__wide" role="alert">{inventoryErrorMessage(save.error)}</p>}
        <div className="form-actions warehouse-form__wide"><button className="button button--primary" disabled={save.isPending || Boolean(problem) || !code}>{save.isPending ? "Salvataggio…" : "Salva posizione"}</button><button className="button button--secondary" type="button" onClick={onClose}>Annulla</button></div>
      </form>
    </Modal>
  );
}

function LimitsForm({ api, limits }: { api: InventoryApi; limits: InventorySettings }) {
  const [draft, setDraft] = useState({ shelf: limits.shelf_max_letter, level: String(limits.level_max), letters: limits.slot_letters, slot: String(limits.slot_max) });
  const save = useMutation({
    mutationFn: async () => {
      const letters = [...new Set(draft.letters.toUpperCase().replace(/[^A-Z]/g, "").split(""))].sort().join("");
      const { error } = await supabase.from("inventory_settings").update({
        shelf_max_letter: draft.shelf, level_max: Number(draft.level), slot_letters: letters, slot_max: Number(draft.slot), updated_at: new Date().toISOString(),
      }).eq("id", true);
      if (error) throw error;
    },
    onSuccess: () => void api.refresh(),
  });
  return (
    <form className="warehouse-form" onSubmit={(event: FormEvent) => { event.preventDefault(); save.mutate(); }}>
      <h3>Limiti dei codici posizione</h3>
      <p className="warehouse-form__wide warehouse-footnote">Servono a impedire codici inesistenti. Impostali in base al magazzino fisico: oggi sono molto larghi.</p>
      <label className="form-field">Ultima lettera dello scaffale
        <select className="input" value={draft.shelf} onChange={(event) => setDraft({ ...draft, shelf: event.target.value })}>{LETTERS.map((letter) => <option key={letter}>{letter}</option>)}</select>
      </label>
      <label className="form-field">Ripiani (da 01 a …)<input className="input" type="number" min={1} max={99} required value={draft.level} onChange={(event) => setDraft({ ...draft, level: event.target.value })} /></label>
      <label className="form-field">Lettere ammesse per il box<input className="input" required pattern="[A-Za-z]+" value={draft.letters} onChange={(event) => setDraft({ ...draft, letters: event.target.value.toUpperCase() })} placeholder="BRC" /></label>
      <label className="form-field">Box (da 01 a …)<input className="input" type="number" min={1} max={99} required value={draft.slot} onChange={(event) => setDraft({ ...draft, slot: event.target.value })} /></label>
      {save.error && <p className="form-error warehouse-form__wide" role="alert">{inventoryErrorMessage(save.error)}</p>}
      {save.isSuccess && <p className="form-success warehouse-form__wide" role="status">Limiti aggiornati.</p>}
      <div className="form-actions warehouse-form__wide"><button className="button button--secondary" disabled={save.isPending}><Save size={16} /> Salva limiti</button></div>
    </form>
  );
}

export function LocationsTab({ api }: { api: InventoryApi }) {
  const [warehouseModal, setWarehouseModal] = useState<Warehouse | "new" | null>(null);
  const [locationModal, setLocationModal] = useState<InventoryLocation | "new" | null>(null);
  const warehouses = api.warehouses.data ?? [];
  const locations = api.locations.data ?? [];
  const items = api.items.data ?? [];
  const limits = api.settings.data ?? DEFAULT_LIMITS;
  const warehouseName = (id: string) => warehouses.find((warehouse) => warehouse.id === id)?.name ?? "—";

  const archiveWarehouse = useMutation({ mutationFn: (input: { id: string; archived: boolean }) => api.write("inventory_archive_warehouse", { p_id: input.id, p_archived: input.archived }) });
  const archiveLocation = useMutation({ mutationFn: (input: { id: string; archived: boolean }) => api.write("inventory_archive_location", { p_id: input.id, p_archived: input.archived }) });
  const error = archiveWarehouse.error ?? archiveLocation.error;

  return (
    <>
      <section className="panel panel__body warehouse-section">
        <header className="warehouse-section__header">
          <div><p className="eyebrow">Mappatura fisica</p><h2><MapPin size={20} /> Posizioni</h2><p>Anagrafica di armadi, scaffali, ripiani e box. Gli articoli si collocano scegliendo una di queste posizioni.</p></div>
          {api.canManage && <button className="button button--primary" type="button" onClick={() => setLocationModal("new")} disabled={!warehouses.some((warehouse) => !warehouse.archived_at)}><Plus size={16} /> Nuova posizione</button>}
        </header>
        {error && <p className="form-error" role="alert">{inventoryErrorMessage(error)}</p>}
        {locations.length === 0 ? (
          <div className="warehouse-empty"><MapPin size={28} /><strong>Ancora nessuna posizione</strong><span>{api.canManage ? "Crea prima un'area magazzino, poi aggiungi le posizioni (es. A-01-B01)." : "La Logistica non ha ancora inserito le posizioni."}</span></div>
        ) : (
          <div className="warehouse-history-wrap">
            <table className="warehouse-history">
              <thead><tr><th>Codice posizione</th><th>Area magazzino</th><th>Scaffale / armadio</th><th>Ripiano</th><th>Box / cassetto</th><th>Contenuto principale</th><th>Articoli</th><th>Note</th>{api.canManage && <th>Azioni</th>}</tr></thead>
              <tbody>{locations.map((location) => {
                const count = items.filter((item) => item.location_id === location.id && !item.archived_at).length;
                return (
                  <tr key={location.id} className={location.archived_at ? "warehouse-item--archived" : undefined}>
                    <td><strong>{location.code}</strong>{location.archived_at && <small>Archiviata</small>}</td><td>{warehouseName(location.warehouse_id)}</td><td>{location.shelf_label || "—"}</td>
                    <td>{location.level_label || "—"}</td><td>{location.box_label || "—"}</td><td>{location.main_content || "—"}</td><td>{count}</td><td>{location.notes || "—"}</td>
                    {api.canManage && <td className="warehouse-sheet__actions">
                      <button className="icon-button" type="button" aria-label={`Modifica ${location.code}`} title="Modifica posizione" onClick={() => setLocationModal(location)}><Pencil size={16} /></button>
                      <button className="icon-button" type="button" aria-label={location.archived_at ? `Ripristina ${location.code}` : `Archivia ${location.code}`} title={location.archived_at ? "Ripristina" : "Archivia"} disabled={archiveLocation.isPending} onClick={() => archiveLocation.mutate({ id: location.id, archived: !location.archived_at })}>{location.archived_at ? <RotateCcw size={16} /> : <Archive size={16} />}</button>
                    </td>}
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel panel__body warehouse-section">
        <header className="warehouse-section__header">
          <div><p className="eyebrow">Spazi</p><h2><WarehouseIcon size={20} /> Aree magazzino</h2><p>I locali che contengono le posizioni (es. Magazzino tecnico, Laboratorio analisi).</p></div>
          {api.canManage && <button className="button button--secondary" type="button" onClick={() => setWarehouseModal("new")}><Plus size={16} /> Nuova area</button>}
        </header>
        {warehouses.length === 0 ? <p>Nessuna area magazzino.</p> : (
          <div className="warehouse-store-list">{warehouses.map((warehouse) => (
            <article className={`warehouse-store ${warehouse.archived_at ? "warehouse-store--archived" : ""}`} key={warehouse.id}>
              <span className="warehouse-store__icon"><WarehouseIcon size={18} /></span>
              <div className="warehouse-store__info"><strong>{warehouse.name}</strong><span>{warehouse.location || "Sede non specificata"}{warehouse.archived_at ? " · Archiviata" : ""}</span>{warehouse.notes && <small>{warehouse.notes}</small>}</div>
              {api.canManage && <div className="warehouse-store__actions">
                <button className="icon-button" type="button" aria-label={`Modifica ${warehouse.name}`} title="Modifica" onClick={() => setWarehouseModal(warehouse)}><Pencil size={16} /></button>
                <button className="icon-button" type="button" aria-label={warehouse.archived_at ? `Ripristina ${warehouse.name}` : `Archivia ${warehouse.name}`} title={warehouse.archived_at ? "Ripristina" : "Archivia"}
                  disabled={archiveWarehouse.isPending || (!warehouse.archived_at && items.some((item) => item.warehouse_id === warehouse.id && !item.archived_at))}
                  onClick={() => archiveWarehouse.mutate({ id: warehouse.id, archived: !warehouse.archived_at })}>{warehouse.archived_at ? <RotateCcw size={16} /> : <Archive size={16} />}</button>
              </div>}
            </article>
          ))}</div>
        )}
        <p className="warehouse-footnote">Per archiviare un'area archivia prima gli articoli attivi al suo interno. La cronologia resta sempre conservata.</p>
      </section>

      {api.canManage && <section className="panel panel__body warehouse-section"><LimitsForm key={JSON.stringify(limits)} api={api} limits={limits} /></section>}

      {warehouseModal && <WarehouseModal api={api} warehouse={warehouseModal === "new" ? null : warehouseModal} onClose={() => setWarehouseModal(null)} />}
      {locationModal && <LocationModal api={api} location={locationModal === "new" ? null : locationModal} limits={limits} onClose={() => setLocationModal(null)} />}
    </>
  );
}
