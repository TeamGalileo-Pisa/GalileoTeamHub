import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Modal } from "../Modal";
import type { InventoryApi } from "../../hooks/useInventory";
import { AREA_LABELS, ITEM_STATUSES, SUBTEAMS, UNITS, inventoryErrorMessage, skuPrefix, type Area, type InventoryItem } from "../../lib/inventory";

/** Valori proposti quando l'articolo nasce da una richiesta di acquisto ricevuta. */
export interface ItemPrefill {
  area?: Area; name?: string; quantity?: string; supplier?: string; unit_cost?: string; purchase_date?: string;
  project_use?: string; purchaseRequestId?: string; purchaseCode?: string;
}

const text = (value: string | null | undefined) => value ?? "";
const optionalNumber = (value: string) => (value.trim() === "" ? null : Number(value));

export function ItemFormModal({ api, item, prefill, onClose }: { api: InventoryApi; item?: InventoryItem | null; prefill?: ItemPrefill; onClose: () => void }) {
  const locations = (api.locations.data ?? []).filter((location) => !location.archived_at || location.id === item?.location_id);
  const warehouses = api.warehouses.data ?? [];
  const startArea: Area = item?.area ?? prefill?.area ?? "tecnica";
  const [draft, setDraft] = useState({
    area: startArea,
    subteam: item?.subteam ?? SUBTEAMS[startArea][0],
    name: item?.name ?? prefill?.name ?? "",
    category: text(item?.category),
    description: text(item?.description),
    quantity: String(item?.quantity ?? prefill?.quantity ?? "0"),
    unit: item?.unit ?? "pz",
    minimum: String(item?.minimum_quantity ?? 0),
    locationId: item?.location_id ?? locations.find((location) => !location.archived_at)?.id ?? "",
    owner: text(item?.owner_name),
    project: item?.project_use ?? prefill?.project_use ?? "",
    supplier: item?.supplier ?? prefill?.supplier ?? "",
    unitCost: item?.unit_cost != null ? String(item.unit_cost) : prefill?.unit_cost ?? "",
    purchaseDate: item?.purchase_date ?? prefill?.purchase_date ?? "",
    expiry: text(item?.expiry_date),
    notes: text(item?.notes),
    specs: text(item?.tech_specs),
    status: item?.status ?? "Disponibile",
  });
  const set = (patch: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...patch }));
  const changeArea = (area: Area) => set({ area, subteam: SUBTEAMS[area][0], status: "Disponibile" });
  const unitOptions = UNITS.includes(draft.unit) ? UNITS : [draft.unit, ...UNITS];

  const save = useMutation({
    mutationFn: async () => {
      const shared = {
        p_name: draft.name, p_category: draft.category, p_description: draft.description, p_unit: draft.unit,
        p_minimum_quantity: Number(draft.minimum), p_owner_name: draft.owner, p_project_use: draft.project, p_supplier: draft.supplier,
        p_unit_cost: optionalNumber(draft.unitCost), p_purchase_date: draft.purchaseDate || null, p_expiry_date: draft.expiry || null,
        p_notes: draft.notes, p_tech_specs: draft.area === "tecnica" ? draft.specs : "", p_status: draft.status,
      };
      if (item) return api.write("inventory_update_item", { p_id: item.id, ...shared });
      return api.write("inventory_create_item", {
        ...shared, p_area: draft.area, p_subteam: draft.subteam, p_quantity: Number(draft.quantity), p_location_id: draft.locationId,
        p_purchase_request_id: prefill?.purchaseRequestId ?? null,
      });
    },
    onSuccess: onClose,
  });
  const submit = (event: FormEvent) => { event.preventDefault(); save.mutate(); };
  const currentLocation = locations.find((location) => location.id === draft.locationId);

  return (
    <Modal title={item ? `Modifica ${item.sku}` : "Nuovo articolo"} onClose={onClose}>
      <form className="warehouse-form" onSubmit={submit}>
        {prefill?.purchaseCode && <p className="warehouse-form__wide form-success">Articolo creato dalla richiesta {prefill.purchaseCode}: alla registrazione verrà inserita anche l'Entrata nei Movimenti.</p>}
        {item ? (
          <p className="warehouse-form__wide warehouse-footnote">
            SKU <strong>{item.sku}</strong> · {AREA_LABELS[item.area]} / {item.subteam} · Giacenza {item.quantity} {item.unit}. Area, sottoteam, SKU, giacenza e posizione non si cambiano qui: usa i Movimenti.
          </p>
        ) : (
          <>
            <label className="form-field">Area *
              <select className="input" value={draft.area} onChange={(event) => changeArea(event.target.value as Area)}>
                {(Object.keys(AREA_LABELS) as Area[]).map((area) => <option key={area} value={area}>{AREA_LABELS[area]}</option>)}
              </select>
            </label>
            <label className="form-field">Sottoteam *
              <select className="input" value={draft.subteam} onChange={(event) => set({ subteam: event.target.value })}>
                {SUBTEAMS[draft.area].map((subteam) => <option key={subteam}>{subteam}</option>)}
              </select>
            </label>
            <p className="warehouse-form__wide warehouse-footnote">Lo SKU viene generato dal sistema e non si può duplicare: <strong>{skuPrefix(draft.area, draft.subteam)}-###</strong></p>
          </>
        )}
        <label className="form-field">{draft.area === "tecnica" ? "Componente *" : "Materiale / strumento *"}
          <input className="input" required minLength={2} maxLength={160} value={draft.name} onChange={(event) => set({ name: event.target.value })} placeholder="Es. vite M8, provetta, sensore MPU6050" />
        </label>
        <label className="form-field">Categoria<input className="input" maxLength={120} value={draft.category} onChange={(event) => set({ category: event.target.value })} /></label>
        {!item && (
          <label className="form-field">Quantità iniziale
            <input className="input" type="number" min={0} max={1000000} step={1} required value={draft.quantity} onChange={(event) => set({ quantity: event.target.value })} />
          </label>
        )}
        <label className="form-field">Unità di misura
          <select className="input" value={draft.unit} onChange={(event) => set({ unit: event.target.value })}>{unitOptions.map((unit) => <option key={unit}>{unit}</option>)}</select>
        </label>
        <label className="form-field">Scorta minima
          <input className="input" type="number" min={0} max={1000000} step={1} required value={draft.minimum} onChange={(event) => set({ minimum: event.target.value })} />
          <small>Si imposta una volta sola: per cambiarla rivolgersi alla Logistica.</small>
        </label>
        {!item && (
          <label className="form-field">Posizione *
            <select className="input" required value={draft.locationId} onChange={(event) => set({ locationId: event.target.value })}>
              <option value="" disabled>Scegli una posizione</option>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.code} · {warehouses.find((w) => w.id === location.warehouse_id)?.name ?? ""}{location.main_content ? ` · ${location.main_content}` : ""}</option>)}
            </select>
            {locations.length === 0 && <small>Crea prima le posizioni nella scheda Posizioni.</small>}
            {currentLocation && <small>Formato [Scaffale]-[Ripiano]-[Box]</small>}
          </label>
        )}
        <label className="form-field">Stato
          <select className="input" value={draft.status} onChange={(event) => set({ status: event.target.value })}>{ITEM_STATUSES[draft.area].map((status) => <option key={status}>{status}</option>)}</select>
        </label>
        <label className="form-field">Responsabile<input className="input" maxLength={160} value={draft.owner} onChange={(event) => set({ owner: event.target.value })} placeholder="Membro o referente di sottoteam" /></label>
        <label className="form-field">Progetto / uso<input className="input" maxLength={240} value={draft.project} onChange={(event) => set({ project: event.target.value })} /></label>
        <label className="form-field">Fornitore<input className="input" maxLength={160} value={draft.supplier} onChange={(event) => set({ supplier: event.target.value })} /></label>
        <label className="form-field">Costo unitario (€)<input className="input" type="number" min={0} step={0.01} value={draft.unitCost} onChange={(event) => set({ unitCost: event.target.value })} /></label>
        <label className="form-field">Data acquisto<input className="input" type="date" value={draft.purchaseDate} onChange={(event) => set({ purchaseDate: event.target.value })} /></label>
        <label className="form-field">Scadenza<input className="input" type="date" value={draft.expiry} onChange={(event) => set({ expiry: event.target.value })} /></label>
        {draft.area === "tecnica" && (
          <label className="form-field warehouse-form__wide">Specifiche tecniche
            <textarea className="input" rows={2} maxLength={3000} value={draft.specs} onChange={(event) => set({ specs: event.target.value })} placeholder="Es. 12V, 2.5 Nm" />
          </label>
        )}
        <label className="form-field warehouse-form__wide">Descrizione<textarea className="input" rows={2} maxLength={3000} value={draft.description} onChange={(event) => set({ description: event.target.value })} /></label>
        <label className="form-field warehouse-form__wide">Note<textarea className="input" rows={2} maxLength={3000} value={draft.notes} onChange={(event) => set({ notes: event.target.value })} /></label>
        {save.error && <p className="form-error warehouse-form__wide" role="alert">{inventoryErrorMessage(save.error)}</p>}
        <div className="form-actions warehouse-form__wide">
          <button className="button button--primary" disabled={save.isPending}>{save.isPending ? "Salvataggio…" : item ? "Salva modifiche" : "Registra articolo"}</button>
          <button className="button button--secondary" type="button" onClick={onClose}>Annulla</button>
        </div>
      </form>
    </Modal>
  );
}
