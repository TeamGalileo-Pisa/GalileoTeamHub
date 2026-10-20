import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Archive, ArrowRightLeft, Boxes, Download, Pencil, Plus, RotateCcw, Search } from "lucide-react";
import type { InventoryApi } from "../../hooks/useInventory";
import {
  AREA_LABELS, SUBTEAMS, downloadBlob, euro, formatDate, inventoryErrorMessage, stockState, todayIso, toCsv, type Area, type InventoryItem,
} from "../../lib/inventory";
import { ItemFormModal } from "./ItemFormModal";
import { MovementModal } from "./MovementsTab";

export type Sheet = "inventario" | "tecnico" | "analisi";

const SHEET_COPY: Record<Sheet, { title: string; eyebrow: string; text: string }> = {
  inventario: { title: "Inventario", eyebrow: "Registro generale", text: "Tutti i materiali con quantità, scorta minima e valore economico." },
  tecnico: { title: "Tecnico", eyebrow: "Meccanica · Elettronica · Motore · Braccio · Sensoristica", text: "Componenti ingegneristici con specifiche tecniche e stato." },
  analisi: { title: "Analisi", eyebrow: "Biologia · Geologia", text: "Strumenti, reagenti e consumabili con unità di misura e stato." },
};

export function ItemsTab({ api, sheet }: { api: InventoryApi; sheet: Sheet }) {
  const [search, setSearch] = useState("");
  const [subteam, setSubteam] = useState("all");
  const [onlyLow, setOnlyLow] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | "new" | null>(null);
  const [moving, setMoving] = useState<InventoryItem | null>(null);
  const area: Area | null = sheet === "tecnico" ? "tecnica" : sheet === "analisi" ? "analisi" : null;
  const copy = SHEET_COPY[sheet];
  const warehouses = api.warehouses.data ?? [];
  const locations = api.locations.data ?? [];
  const codeOf = (id: string | null) => locations.find((location) => location.id === id)?.code ?? "—";

  const archive = useMutation({
    mutationFn: (input: { id: string; archived: boolean }) => api.write("inventory_archive_item", { p_id: input.id, p_archived: input.archived }),
  });

  const all = useMemo(() => (api.items.data ?? []).filter((item) => !area || item.area === area), [api.items.data, area]);
  const active = all.filter((item) => !item.archived_at && !warehouses.find((w) => w.id === item.warehouse_id)?.archived_at);
  const rows = useMemo(() => all.filter((item) => {
    if (Boolean(item.archived_at) !== showArchived) return false;
    if (subteam !== "all" && item.subteam !== subteam) return false;
    if (onlyLow && stockState(item.quantity, item.minimum_quantity) !== "RIORDINARE") return false;
    const haystack = `${item.sku} ${item.name} ${item.category} ${item.description} ${item.owner_name} ${item.project_use} ${item.supplier}`.toLocaleLowerCase("it");
    return haystack.includes(search.trim().toLocaleLowerCase("it"));
  }), [all, showArchived, subteam, onlyLow, search]);

  const low = active.filter((item) => stockState(item.quantity, item.minimum_quantity) === "RIORDINARE").length;
  const totalValue = active.reduce((sum, item) => sum + Number(item.total_value ?? 0), 0);
  const onLoan = active.reduce((sum, item) => sum + item.on_loan, 0);

  const exportCsv = () => {
    const header = ["SKU", "Area", "Sottoteam", "Categoria", "Nome materiale", "Descrizione", "Quantità", "Unità", "Scorta minima", "Stato scorta", "Posizione", "Responsabile", "Progetto/uso", "Fornitore", "Costo unitario (€)", "Valore totale (€)", "Data acquisto", "Scadenza", "Stato", "Specifiche tecniche", "Note"];
    downloadBlob(toCsv([header, ...rows.map((item) => [
      item.sku, AREA_LABELS[item.area], item.subteam, item.category, item.name, item.description, item.quantity, item.unit, item.minimum_quantity,
      stockState(item.quantity, item.minimum_quantity), codeOf(item.location_id), item.owner_name, item.project_use, item.supplier, item.unit_cost,
      item.total_value, item.purchase_date, item.expiry_date, item.status, item.tech_specs, item.notes,
    ])]), `${sheet}-magazzino-${todayIso()}.csv`);
  };

  const stateBadge = (item: InventoryItem) => {
    const state = stockState(item.quantity, item.minimum_quantity);
    return <span className={`warehouse-event warehouse-event--${state === "OK" ? "stock_in" : "stock_out"}`}>{state}</span>;
  };
  const quantityCell = (item: InventoryItem) => <>{item.quantity} {item.unit}{item.on_loan > 0 && <small>{item.on_loan} in prestito</small>}</>;

  return (
    <section className="panel panel__body warehouse-section">
      <header className="warehouse-section__header">
        <div><p className="eyebrow">{copy.eyebrow}</p><h2>{copy.title}</h2><p>{copy.text}</p></div>
        <div className="warehouse-history-actions">
          <button className="button button--secondary" type="button" onClick={exportCsv}><Download size={16} /> Esporta CSV</button>
          {api.canManage && <button className="button button--primary" type="button" onClick={() => setEditing("new")}><Plus size={16} /> Aggiungi articolo</button>}
        </div>
      </header>

      {sheet === "inventario" && (
        <div className="warehouse-stats" aria-label="Riepilogo inventario">
          <article className="warehouse-stat"><span>Articoli attivi</span><strong>{active.length}</strong></article>
          <article className={`warehouse-stat ${low ? "warehouse-stat--warning" : ""}`}><span>Da riordinare</span><strong>{low}</strong></article>
          <article className="warehouse-stat"><span>Valore a magazzino</span><strong>{euro.format(totalValue)}</strong></article>
          <article className="warehouse-stat"><span>Pezzi in prestito</span><strong>{onLoan}</strong></article>
        </div>
      )}

      <div className="warehouse-filters">
        {area && <label><span className="sr-only">Sottoteam</span>
          <select className="input" value={subteam} onChange={(event) => setSubteam(event.target.value)}>
            <option value="all">Tutti i sottoteam</option>{SUBTEAMS[area].map((name) => <option key={name}>{name}</option>)}
          </select>
        </label>}
        <label className="warehouse-filter-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cerca SKU, materiale, responsabile…" /></label>
        <label className="warehouse-archived-toggle"><input type="checkbox" checked={onlyLow} onChange={(event) => setOnlyLow(event.target.checked)} /> Solo da riordinare</label>
        <label className="warehouse-archived-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Mostra archiviati</label>
      </div>

      {api.items.isLoading ? <p>Caricamento inventario…</p> : rows.length === 0 ? (
        <div className="warehouse-empty"><Boxes size={28} /><strong>{showArchived ? "Nessun articolo archiviato" : "Nessun articolo trovato"}</strong><span>{api.canManage ? "Aggiungi gli articoli per iniziare, dopo aver creato le posizioni." : "La Logistica non ha ancora inserito articoli."}</span></div>
      ) : (
        <div className="warehouse-history-wrap">
          <table className="warehouse-history warehouse-sheet">
            <thead><tr>
              <th>SKU</th>
              {sheet === "inventario" ? <><th>Area</th><th>Categoria</th><th>Nome materiale</th><th>Quantità</th><th>Scorta min.</th><th>Stato scorta</th><th>Posizione</th><th>Responsabile</th><th>Costo unit.</th><th>Valore tot.</th></> : null}
              {sheet === "tecnico" ? <><th>Sottoteam</th><th>Categoria</th><th>Componente</th><th>Specifiche tecniche</th><th>Quantità</th><th>Stato</th><th>Posizione</th><th>Uso</th><th>Responsabile</th><th>Note</th></> : null}
              {sheet === "analisi" ? <><th>Sottoteam</th><th>Categoria</th><th>Materiale / strumento</th><th>Descrizione</th><th>Quantità</th><th>Stato scorta</th><th>Stato</th><th>Scadenza</th><th>Posizione</th><th>Responsabile</th><th>Uso</th><th>Note</th></> : null}
              <th>Azioni</th>
            </tr></thead>
            <tbody>{rows.map((item) => (
              <tr key={item.id} className={item.archived_at ? "warehouse-item--archived" : undefined}>
                <td><strong>{item.sku}</strong></td>
                {sheet === "inventario" && <>
                  <td>{AREA_LABELS[item.area]}<small>{item.subteam}</small></td><td>{item.category || "—"}</td><td><strong>{item.name}</strong><small>{item.description}</small></td>
                  <td>{quantityCell(item)}</td><td>{item.minimum_quantity}</td><td>{stateBadge(item)}</td><td>{codeOf(item.location_id)}</td><td>{item.owner_name || "—"}</td>
                  <td>{item.unit_cost != null ? euro.format(item.unit_cost) : "—"}</td><td>{item.total_value != null ? euro.format(item.total_value) : "—"}</td>
                </>}
                {sheet === "tecnico" && <>
                  <td>{item.subteam}</td><td>{item.category || "—"}</td><td><strong>{item.name}</strong></td><td>{item.tech_specs || "—"}</td><td>{quantityCell(item)}</td>
                  <td>{item.status}</td><td>{codeOf(item.location_id)}</td><td>{item.project_use || "—"}</td><td>{item.owner_name || "—"}</td><td>{item.notes || "—"}</td>
                </>}
                {sheet === "analisi" && <>
                  <td>{item.subteam}</td><td>{item.category || "—"}</td><td><strong>{item.name}</strong></td><td>{item.description || "—"}</td><td>{quantityCell(item)}</td>
                  <td>{stateBadge(item)}</td><td>{item.status}</td><td>{formatDate(item.expiry_date)}</td><td>{codeOf(item.location_id)}</td><td>{item.owner_name || "—"}</td><td>{item.project_use || "—"}</td><td>{item.notes || "—"}</td>
                </>}
                <td className="warehouse-sheet__actions">
                  {!item.archived_at && <button className="icon-button" type="button" title="Registra un movimento" aria-label={`Registra un movimento per ${item.name}`} onClick={() => setMoving(item)}><ArrowRightLeft size={16} /></button>}
                  {api.canManage && !item.archived_at && <button className="icon-button" type="button" title="Modifica articolo" aria-label={`Modifica ${item.name}`} onClick={() => setEditing(item)}><Pencil size={16} /></button>}
                  {api.canManage && <button className="icon-button" type="button" title={item.archived_at ? "Ripristina articolo" : "Archivia articolo"} aria-label={item.archived_at ? `Ripristina ${item.name}` : `Archivia ${item.name}`} disabled={archive.isPending} onClick={() => archive.mutate({ id: item.id, archived: !item.archived_at })}>{item.archived_at ? <RotateCcw size={16} /> : <Archive size={16} />}</button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {archive.error && <p className="form-error" role="alert">{inventoryErrorMessage(archive.error)}</p>}
      <p className="warehouse-footnote">Lo stato scorta si calcola da solo: RIORDINARE quando la quantità è minore o uguale alla scorta minima, altrimenti OK. La quantità cambia solo con i Movimenti.</p>
      {editing && <ItemFormModal api={api} item={editing === "new" ? null : editing} prefill={editing === "new" && area ? { area } : undefined} onClose={() => setEditing(null)} />}
      {moving && <MovementModal api={api} item={moving} onClose={() => setMoving(null)} />}
    </section>
  );
}
