import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowDownToLine, ArrowUpFromLine, Boxes, History, Pencil, Plus, RotateCcw, Search, Warehouse, X } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "../lib/supabase";

type Store = { id: string; name: string; location: string; notes: string; archived_at: string | null };
type StockItem = { id: string; warehouse_id: string; name: string; sku: string; description: string; unit: string; quantity: number; minimum_quantity: number; archived_at: string | null; updated_at: string };
type InventoryEvent = { id: number; warehouse_id: string | null; item_id: string | null; warehouse_name_snapshot: string; item_name_snapshot: string; event_type: string; quantity_delta: number; quantity_before: number | null; quantity_after: number | null; actor_name: string; taken_by_name: string; notes: string; details: Record<string, unknown>; created_at: string };

const emptyItem = { warehouse_id: "", name: "", sku: "", description: "", unit: "pezzi", initial_quantity: "0", minimum_quantity: "0" };
const eventLabels: Record<string, string> = {
  warehouse_created: "Magazzino creato", warehouse_updated: "Magazzino modificato", warehouse_archived: "Magazzino archiviato", warehouse_restored: "Magazzino ripristinato",
  item_created: "Articolo inserito", item_updated: "Articolo modificato", item_archived: "Articolo archiviato", item_restored: "Articolo ripristinato", stock_in: "Carico", stock_out: "Prelievo",
};

async function rpc<T = unknown>(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data as T;
}

function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

async function exportLedger() {
  const rows = await readLedger();
  downloadLedger(rows);
  return rows.length;
}

async function readLedger() {
  const rows: InventoryEvent[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("inventory_movements").select("*").order("id", { ascending: true }).range(offset, offset + 999);
    if (error) throw error;
    const batch = (data ?? []) as InventoryEvent[];
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  return rows;
}

function ledgerCsv(rows: InventoryEvent[]) {
  const header = ["Data e ora", "Evento", "Magazzino", "Articolo", "Variazione quantità", "Prima", "Dopo", "Operatore account", "Prelevato da", "Note", "Dettagli modifica"];
  const lines = [header, ...rows.map((row) => [
    new Date(row.created_at).toLocaleString("it-IT"), eventLabels[row.event_type] ?? row.event_type,
    row.warehouse_name_snapshot, row.item_name_snapshot, row.quantity_delta, row.quantity_before, row.quantity_after,
    row.actor_name, row.taken_by_name, row.notes, row.details,
  ])].map((line) => line.map(csvCell).join(";"));
  return new Blob(["\ufeff", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
}

function downloadLedger(rows: InventoryEvent[]) {
  const blob = ledgerCsv(rows);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `registro-magazzino-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function WarehousePage() {
  const { access } = useAuth();
  const cache = useQueryClient();
  const canUse = Boolean(access?.isTeamLeader || access?.areas.some((area) => area.slug === "logistica"));
  const [warehouseDraft, setWarehouseDraft] = useState({ id: "", name: "", location: "", notes: "" });
  const [showWarehouseForm, setShowWarehouseForm] = useState(false);
  const [itemDraft, setItemDraft] = useState(emptyItem);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [movementItem, setMovementItem] = useState<string | null>(null);
  const [movementType, setMovementType] = useState<"stock_in" | "stock_out">("stock_in");
  const [movementQuantity, setMovementQuantity] = useState("1");
  const [takenBy, setTakenBy] = useState("");
  const [movementNotes, setMovementNotes] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [operatorName, setOperatorName] = useState("");
  const [backupState, setBackupState] = useState<"syncing" | "saved" | "error" | "idle">("idle");
  const [backupError, setBackupError] = useState("");

  const updateExternalLedger = async () => {
    setBackupState("syncing");
    setBackupError("");
    try {
      const rows = await readLedger();
      const { error } = await supabase.storage.from("inventory-audit").upload("registro-magazzino.csv", ledgerCsv(rows), {
        upsert: true, contentType: "text/csv", cacheControl: "0",
      });
      if (error) throw error;
      setBackupState("saved");
      return rows.length;
    } catch (error) {
      setBackupState("error");
      setBackupError(error instanceof Error ? error.message : "Impossibile aggiornare la copia esterna.");
      return null;
    }
  };

  const writeRpc = async <T,>(name: string, args: Record<string, unknown>) => {
    if (operatorName.trim().length < 2) throw new Error("Inserisci nome e cognome dell’operatore.");
    const result = await rpc<T>(name, { ...args, p_actor_name: operatorName.trim() });
    await updateExternalLedger();
    return result;
  };

  useEffect(() => {
    if (canUse) void updateExternalLedger();
    // Sync once when an authorized inventory screen opens; writes sync again after each operation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUse]);

  const stores = useQuery({ queryKey: ["inventory-warehouses"], enabled: canUse, queryFn: async () => {
    const { data, error } = await supabase.from("inventory_warehouses").select("*").order("created_at");
    if (error) throw error;
    return data as Store[];
  }});
  const items = useQuery({ queryKey: ["inventory-items"], enabled: canUse, queryFn: async () => {
    const { data, error } = await supabase.from("inventory_items").select("*").order("name");
    if (error) throw error;
    return data as StockItem[];
  }});
  const history = useQuery({ queryKey: ["inventory-history"], enabled: canUse, queryFn: async () => {
    const { data, error } = await supabase.from("inventory_movements").select("*").order("id", { ascending: false }).limit(100);
    if (error) throw error;
    return data as InventoryEvent[];
  }});
  const refresh = () => Promise.all([
    cache.invalidateQueries({ queryKey: ["inventory-warehouses"] }),
    cache.invalidateQueries({ queryKey: ["inventory-items"] }),
    cache.invalidateQueries({ queryKey: ["inventory-history"] }),
  ]);
  const saveWarehouse = useMutation({ mutationFn: async () => warehouseDraft.id
    ? writeRpc("inventory_update_warehouse", { p_id: warehouseDraft.id, p_name: warehouseDraft.name, p_location: warehouseDraft.location, p_notes: warehouseDraft.notes })
    : writeRpc("inventory_create_warehouse", { p_name: warehouseDraft.name, p_location: warehouseDraft.location, p_notes: warehouseDraft.notes }), onSuccess: () => { void refresh(); setWarehouseDraft({ id: "", name: "", location: "", notes: "" }); setShowWarehouseForm(false); }});
  const archiveWarehouse = useMutation({ mutationFn: (input: { id: string; archived: boolean }) => writeRpc("inventory_archive_warehouse", { p_id: input.id, p_archived: input.archived }), onSuccess: refresh });
  const saveItem = useMutation({ mutationFn: async () => editingItem
    ? writeRpc("inventory_update_item", { p_id: editingItem, p_name: itemDraft.name, p_sku: itemDraft.sku, p_description: itemDraft.description, p_unit: itemDraft.unit, p_minimum_quantity: Number(itemDraft.minimum_quantity) })
    : writeRpc("inventory_create_item", { p_warehouse_id: itemDraft.warehouse_id, p_name: itemDraft.name, p_sku: itemDraft.sku, p_description: itemDraft.description, p_unit: itemDraft.unit, p_initial_quantity: Number(itemDraft.initial_quantity), p_minimum_quantity: Number(itemDraft.minimum_quantity) }), onSuccess: () => { void refresh(); setItemDraft(emptyItem); setEditingItem(null); }});
  const moveStock = useMutation({ mutationFn: () => writeRpc("inventory_stock_movement", { p_item_id: movementItem, p_event: movementType, p_quantity: Number(movementQuantity), p_taken_by: takenBy, p_notes: movementNotes }), onSuccess: () => { void refresh(); setMovementItem(null); setTakenBy(""); setMovementNotes(""); setMovementQuantity("1"); }});
  const archiveItem = useMutation({ mutationFn: (input: { id: string; archived: boolean }) => writeRpc("inventory_archive_item", { p_id: input.id, p_archived: input.archived }), onSuccess: refresh });
  const exportHistory = useMutation({ mutationFn: exportLedger });

  const allStores = stores.data ?? [];
  const visibleItems = useMemo(() => (items.data ?? []).filter((item) => {
    const matchStore = warehouseFilter === "all" || item.warehouse_id === warehouseFilter;
    const store = allStores.find((value) => value.id === item.warehouse_id);
    const haystack = `${item.name} ${item.sku} ${item.description} ${store?.name ?? ""}`.toLocaleLowerCase("it");
    return matchStore && (showArchived ? Boolean(item.archived_at) : !item.archived_at) && (showArchived || !store?.archived_at) && haystack.includes(search.trim().toLocaleLowerCase("it"));
  }), [items.data, allStores, warehouseFilter, search, showArchived]);
  const activeItems = (items.data ?? []).filter((item) => !item.archived_at && !allStores.find((store) => store.id === item.warehouse_id)?.archived_at);
  const lowItems = activeItems.filter((item) => item.quantity <= item.minimum_quantity);
  const pageError = stores.error ?? items.error ?? history.error ?? saveWarehouse.error ?? archiveWarehouse.error ?? saveItem.error ?? moveStock.error ?? archiveItem.error ?? exportHistory.error;

  const startEditItem = (item: StockItem) => {
    setEditingItem(item.id);
    setItemDraft({ warehouse_id: item.warehouse_id, name: item.name, sku: item.sku, description: item.description, unit: item.unit, initial_quantity: "0", minimum_quantity: String(item.minimum_quantity) });
  };
  const eventMessage = (event: InventoryEvent) => {
    if (event.event_type === "item_updated" || event.event_type === "warehouse_updated") {
      const before = event.details.before as Record<string, unknown> | undefined;
      const after = event.details.after as Record<string, unknown> | undefined;
      return before && after ? `${String(before.name ?? "")} → ${String(after.name ?? "")} · Dettagli precedenti e aggiornati inclusi nell’esportazione` : "Modifica registrata";
    }
    return event.notes || (event.quantity_delta ? `${event.quantity_delta > 0 ? "+" : ""}${event.quantity_delta}` : "—");
  };

  if (!canUse) return <div className="page-container"><PageHeader title="Magazzino" eyebrow="Accesso riservato" description="Questa sezione è disponibile al Team Leader e agli account dell’area Logistica." /><section className="panel panel__body"><p>Il tuo account non è abilitato a questo magazzino.</p></section></div>;

  return <div className="page-container warehouse-page">
    <PageHeader title="Magazzino" eyebrow="Logistica · Registro inventario" description="Gestisci le scorte e consulta la cronologia completa di carichi, prelievi e modifiche. I record vengono archiviati, non cancellati." />
    {pageError && <p className="form-error" role="alert">{pageError instanceof Error ? pageError.message : "Operazione non riuscita. Riprova."}</p>}

    <section className="panel panel__body warehouse-operator">
      <label className="form-field">Nome e cognome dell’operatore
        <input className="input" required minLength={2} maxLength={160} value={operatorName} onChange={(event) => setOperatorName(event.target.value)} placeholder="Chi sta registrando le operazioni" />
      </label>
      <p>Il registro conserva anche l’account usato. Con l’account condiviso Logistica, inserisci qui il nome della persona presente.</p>
    </section>

    <section className="warehouse-stats" aria-label="Riepilogo inventario">
      <article className="warehouse-stat"><span>Articoli attivi</span><strong>{activeItems.length}</strong></article>
      <article className={`warehouse-stat ${lowItems.length ? "warehouse-stat--warning" : ""}`}><span>Da riordinare</span><strong>{lowItems.length}</strong></article>
      <article className="warehouse-stat"><span>Magazzini attivi</span><strong>{allStores.filter((store) => !store.archived_at).length}</strong></article>
    </section>

    <section className="panel panel__body warehouse-section">
      <header className="warehouse-section__header"><div><p className="eyebrow">Spazi e ubicazioni</p><h2>I magazzini</h2><p>Puoi creare più magazzini e indicare dove si trovano.</p></div><button className="button button--secondary" type="button" onClick={() => { setWarehouseDraft({ id: "", name: "", location: "", notes: "" }); setShowWarehouseForm((value) => !value); }}><Plus size={16} /> Nuovo magazzino</button></header>
      {showWarehouseForm && <form className="warehouse-form" onSubmit={(event) => { event.preventDefault(); saveWarehouse.mutate(); }}>
        <h3>{warehouseDraft.id ? "Modifica magazzino" : "Crea un magazzino"}</h3>
        <label className="form-field">Nome<input className="input" required minLength={2} maxLength={120} value={warehouseDraft.name} onChange={(event) => setWarehouseDraft({ ...warehouseDraft, name: event.target.value })} placeholder="Es. Laboratorio, armadio elettronica" /></label>
        <label className="form-field">Posizione<input className="input" maxLength={240} value={warehouseDraft.location} onChange={(event) => setWarehouseDraft({ ...warehouseDraft, location: event.target.value })} placeholder="Edificio, stanza, scaffale" /></label>
        <label className="form-field warehouse-form__wide">Note<textarea className="input" rows={2} maxLength={2000} value={warehouseDraft.notes} onChange={(event) => setWarehouseDraft({ ...warehouseDraft, notes: event.target.value })} /></label>
        <div className="form-actions warehouse-form__wide"><button className="button button--primary" disabled={saveWarehouse.isPending}>{saveWarehouse.isPending ? "Salvataggio…" : "Salva magazzino"}</button><button className="button button--secondary" type="button" onClick={() => setShowWarehouseForm(false)}>Annulla</button></div>
      </form>}
      {stores.isLoading ? <p>Caricamento magazzini…</p> : allStores.length === 0 ? <div className="warehouse-empty"><Warehouse size={28} /><strong>Ancora nessun magazzino</strong><span>Crea il primo spazio per iniziare a registrare gli articoli.</span></div> : <div className="warehouse-store-list">{allStores.map((store) => <article className={`warehouse-store ${store.archived_at ? "warehouse-store--archived" : ""}`} key={store.id}>
        <span className="warehouse-store__icon"><Warehouse size={18} /></span><div className="warehouse-store__info"><strong>{store.name}</strong><span>{store.location || "Posizione non specificata"}{store.archived_at ? " · Archiviato" : ""}</span>{store.notes && <small>{store.notes}</small>}</div>
        <div className="warehouse-store__actions"><button className="icon-button" type="button" title="Modifica magazzino" aria-label={`Modifica ${store.name}`} onClick={() => { setWarehouseDraft({ id: store.id, name: store.name, location: store.location, notes: store.notes }); setShowWarehouseForm(true); }}><Pencil size={16} /></button><button className="icon-button" type="button" title={store.archived_at ? "Ripristina magazzino" : "Archivia magazzino"} aria-label={store.archived_at ? `Ripristina ${store.name}` : `Archivia ${store.name}`} disabled={archiveWarehouse.isPending || (!store.archived_at && (items.data ?? []).some((item) => item.warehouse_id === store.id && !item.archived_at))} onClick={() => archiveWarehouse.mutate({ id: store.id, archived: !store.archived_at })}>{store.archived_at ? <RotateCcw size={16} /> : <Archive size={16} />}</button></div>
      </article>)}</div>}
      <p className="warehouse-footnote">Per archiviare un magazzino, archivia prima gli articoli attivi al suo interno. La cronologia resta conservata.</p>
    </section>

    <section className="panel panel__body warehouse-section">
      <header className="warehouse-section__header"><div><p className="eyebrow">Inventario</p><h2>Articoli e quantità</h2><p>Ogni variazione viene registrata con data, account operatore e persona che ha ritirato il materiale.</p></div><button className="button button--primary" type="button" disabled={!allStores.some((store) => !store.archived_at)} onClick={() => { setEditingItem(null); setItemDraft({ ...emptyItem, warehouse_id: allStores.find((store) => !store.archived_at)?.id ?? "" }); }}><Plus size={16} /> Aggiungi articolo</button></header>
      {(!editingItem && itemDraft.name === "" && itemDraft.warehouse_id !== "" || editingItem) && <form className="warehouse-form" onSubmit={(event) => { event.preventDefault(); saveItem.mutate(); }}>
        <h3>{editingItem ? "Modifica articolo" : "Nuovo articolo"}</h3>
        <label className="form-field">Magazzino<select className="input" required value={itemDraft.warehouse_id} onChange={(event) => setItemDraft({ ...itemDraft, warehouse_id: event.target.value })} disabled={Boolean(editingItem)}>{allStores.filter((store) => !store.archived_at).map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
        <label className="form-field">Nome articolo<input className="input" required minLength={2} maxLength={160} value={itemDraft.name} onChange={(event) => setItemDraft({ ...itemDraft, name: event.target.value })} placeholder="Es. Guanti nitrile" /></label>
        <label className="form-field">Codice / SKU<input className="input" maxLength={80} value={itemDraft.sku} onChange={(event) => setItemDraft({ ...itemDraft, sku: event.target.value })} /></label>
        <label className="form-field">Unità di misura<input className="input" required maxLength={30} value={itemDraft.unit} onChange={(event) => setItemDraft({ ...itemDraft, unit: event.target.value })} placeholder="pezzi, metri, confezioni" /></label>
        {!editingItem && <label className="form-field">Quantità iniziale<input className="input" type="number" min="0" max="1000000" step="1" value={itemDraft.initial_quantity} onChange={(event) => setItemDraft({ ...itemDraft, initial_quantity: event.target.value })} /></label>}
        <label className="form-field">Soglia scorte basse<input className="input" type="number" min="0" max="1000000" step="1" value={itemDraft.minimum_quantity} onChange={(event) => setItemDraft({ ...itemDraft, minimum_quantity: event.target.value })} /></label>
        <label className="form-field warehouse-form__wide">Descrizione<textarea className="input" rows={3} maxLength={3000} value={itemDraft.description} onChange={(event) => setItemDraft({ ...itemDraft, description: event.target.value })} /></label>
        <div className="form-actions warehouse-form__wide"><button className="button button--primary" disabled={saveItem.isPending}>{saveItem.isPending ? "Salvataggio…" : editingItem ? "Salva modifiche" : "Registra articolo"}</button><button className="button button--secondary" type="button" onClick={() => { setEditingItem(null); setItemDraft(emptyItem); }}>Annulla</button></div>
      </form>}
      <div className="warehouse-filters"><label><span className="sr-only">Filtra per magazzino</span><select className="input" value={warehouseFilter} onChange={(event) => setWarehouseFilter(event.target.value)}><option value="all">Tutti i magazzini</option>{allStores.map((store) => <option key={store.id} value={store.id}>{store.name}{store.archived_at ? " (archiviato)" : ""}</option>)}</select></label><label className="warehouse-filter-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cerca articolo o codice" /></label><label className="warehouse-archived-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Mostra archiviati</label></div>
      {items.isLoading ? <p>Caricamento inventario…</p> : visibleItems.length === 0 ? <div className="warehouse-empty"><Boxes size={28} /><strong>{showArchived ? "Nessun articolo archiviato" : "Nessun articolo in questo magazzino"}</strong><span>Registra gli articoli e le quantità iniziali per iniziare.</span></div> : <div className="warehouse-item-list">{visibleItems.map((item) => {
        const store = allStores.find((candidate) => candidate.id === item.warehouse_id);
        const isLow = item.quantity <= item.minimum_quantity;
        return <article className={`warehouse-item ${item.archived_at ? "warehouse-item--archived" : ""}`} key={item.id}>
          <div className="warehouse-item__main"><div className="warehouse-item__title"><h3>{item.name}</h3>{item.sku && <span className="warehouse-item__sku">{item.sku}</span>}</div><p>{item.description || "Nessuna descrizione"}</p><span className="warehouse-item__location">{store?.name ?? "Magazzino archiviato"} · {item.unit}{item.archived_at ? " · Archiviato" : ""}</span></div>
          <div className={`warehouse-item__quantity ${isLow && !item.archived_at ? "warehouse-item__quantity--low" : ""}`}><strong>{item.quantity}</strong><span>{isLow && !item.archived_at ? "Scorta bassa" : `min. ${item.minimum_quantity}`}</span></div>
          <div className="warehouse-item__actions">{!item.archived_at && <><button className="button button--secondary button--small" type="button" onClick={() => { setMovementItem(item.id); setMovementType("stock_in"); setMovementQuantity("1"); }}><ArrowDownToLine size={15} /> Carica</button><button className="button button--secondary button--small" type="button" onClick={() => { setMovementItem(item.id); setMovementType("stock_out"); setMovementQuantity("1"); }}><ArrowUpFromLine size={15} /> Preleva</button><button className="icon-button" type="button" title="Modifica articolo" aria-label={`Modifica ${item.name}`} onClick={() => startEditItem(item)}><Pencil size={16} /></button></>}
            <button className="icon-button" type="button" title={item.archived_at ? "Ripristina articolo" : "Archivia articolo"} aria-label={item.archived_at ? `Ripristina ${item.name}` : `Archivia ${item.name}`} disabled={archiveItem.isPending} onClick={() => archiveItem.mutate({ id: item.id, archived: !item.archived_at })}>{item.archived_at ? <RotateCcw size={16} /> : <Archive size={16} />}</button></div>
          {movementItem === item.id && <form className="warehouse-movement-form" onSubmit={(event) => { event.preventDefault(); moveStock.mutate(); }}>
            <strong>{movementType === "stock_in" ? "Carica scorte" : "Registra un prelievo"} · {item.name}</strong>
            <label className="form-field">Quantità<input className="input" autoFocus type="number" min="1" max="1000000" step="1" required value={movementQuantity} onChange={(event) => setMovementQuantity(event.target.value)} /></label>
            {movementType === "stock_out" && <label className="form-field">Nome e cognome di chi ritira<input className="input" required minLength={2} maxLength={160} value={takenBy} onChange={(event) => setTakenBy(event.target.value)} placeholder="Chi ha preso il materiale" /></label>}
            <label className="form-field warehouse-movement-form__notes">Note<textarea className="input" rows={2} maxLength={2000} value={movementNotes} onChange={(event) => setMovementNotes(event.target.value)} placeholder="Motivo o progetto di destinazione" /></label>
            <div className="warehouse-form__wide"><button className="button button--primary button--small" disabled={moveStock.isPending}>{moveStock.isPending ? "Registrazione…" : "Registra movimento"}</button> <button className="button button--secondary button--small" type="button" onClick={() => setMovementItem(null)}><X size={14} /> Annulla</button></div>
          </form>}
        </article>;
      })}</div>}
    </section>

    <section className="panel panel__body warehouse-section">
      <header className="warehouse-section__header"><div><p className="eyebrow">Registro permanente</p><h2><History size={21} /> Cronologia completa</h2><p>Gli ultimi 100 eventi sono visibili qui. Tutta la cronologia viene conservata in un file privato aggiornato automaticamente e può essere scaricata in CSV.</p></div><div className="warehouse-history-actions"><button className="button button--secondary" type="button" disabled={backupState === "syncing"} onClick={() => void updateExternalLedger()}><RotateCcw size={16} /> {backupState === "syncing" ? "Aggiorno copia…" : "Aggiorna copia esterna"}</button><button className="button button--secondary" type="button" disabled={exportHistory.isPending} onClick={() => exportHistory.mutate()}><ArrowDownToLine size={16} /> {exportHistory.isPending ? "Creo il file…" : "Esporta registro CSV"}</button></div></header>
      {backupState === "saved" && <p className="form-success" role="status">Copia esterna aggiornata: registro-magazzino.csv ({history.data?.length ? "cronologia completa" : "registro attualmente vuoto"}). Il file resta disponibile anche se articoli o magazzini vengono archiviati.</p>}
      {backupState === "error" && <p className="form-error" role="alert">La cronologia nel database è salva, ma la copia CSV esterna non si è aggiornata. Riprova; errore: {backupError}</p>}
      {exportHistory.isSuccess && <p className="form-success" role="status">Registro completo esportato: {exportHistory.data} eventi.</p>}
      {history.isLoading ? <p>Caricamento cronologia…</p> : (history.data?.length ?? 0) === 0 ? <p>Nessuna attività registrata.</p> : <div className="warehouse-history-wrap"><table className="warehouse-history"><thead><tr><th>Data e ora</th><th>Attività</th><th>Articolo / magazzino</th><th>Quantità</th><th>Operatore</th><th>Ritirato da</th><th>Dettagli</th></tr></thead><tbody>{history.data?.map((event) => <tr key={event.id}><td>{new Date(event.created_at).toLocaleString("it-IT")}</td><td><span className={`warehouse-event warehouse-event--${event.event_type.startsWith("stock_") ? event.event_type : "edit"}`}>{eventLabels[event.event_type] ?? event.event_type}</span></td><td><strong>{event.item_name_snapshot || "—"}</strong><small>{event.warehouse_name_snapshot}</small></td><td>{event.quantity_delta > 0 ? `+${event.quantity_delta}` : event.quantity_delta || "—"}{event.quantity_before !== null && event.quantity_after !== null && event.event_type.startsWith("stock_") && <small>{event.quantity_before} → {event.quantity_after}</small>}</td><td>{event.actor_name}</td><td>{event.taken_by_name || "—"}</td><td>{eventMessage(event)}</td></tr>)}</tbody></table></div>}
      <p className="warehouse-footnote">La cronologia è append-only: la UI non consente di modificarla o cancellarla. Archiviare un elemento ne nasconde l’operatività, non i suoi eventi.</p>
    </section>
  </div>;
}
