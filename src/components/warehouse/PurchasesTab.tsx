import { useMemo, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { PackageCheck, Plus, ShoppingCart } from "lucide-react";
import { Modal } from "../Modal";
import type { InventoryApi } from "../../hooks/useInventory";
import {
  AREA_LABELS, PRIORITIES, PURCHASE_FLOW, euro, formatDate, inventoryErrorMessage, todayIso, type Area, type PurchaseRequest,
} from "../../lib/inventory";
import { ItemFormModal, type ItemPrefill } from "./ItemFormModal";

function RequestModal({ api, onClose }: { api: InventoryApi; onClose: () => void }) {
  const [draft, setDraft] = useState({
    material: "", area: "tecnica" as Area, quantity: "1", priority: "Media", requester: api.access?.displayName ?? "", reason: "", supplier: "", cost: "", notes: "",
  });
  const set = (patch: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...patch }));
  const save = useMutation({
    mutationFn: () => api.write("inventory_create_purchase_request", {
      p_material: draft.material, p_area: draft.area, p_quantity: Number(draft.quantity), p_priority: draft.priority, p_requester_name: draft.requester,
      p_reason: draft.reason, p_supplier: draft.supplier, p_estimated_cost: draft.cost.trim() === "" ? null : Number(draft.cost), p_notes: draft.notes,
    }),
    onSuccess: onClose,
  });
  return (
    <Modal title="Nuova richiesta di acquisto" onClose={onClose}>
      <form className="warehouse-form" onSubmit={(event: FormEvent) => { event.preventDefault(); save.mutate(); }}>
        <label className="form-field warehouse-form__wide">Materiale *<input className="input" required minLength={2} maxLength={200} value={draft.material} onChange={(event) => set({ material: event.target.value })} /></label>
        <label className="form-field">Area *
          <select className="input" value={draft.area} onChange={(event) => set({ area: event.target.value as Area })}>{(Object.keys(AREA_LABELS) as Area[]).map((area) => <option key={area} value={area}>{AREA_LABELS[area]}</option>)}</select>
        </label>
        <label className="form-field">Quantità *<input className="input" type="number" min={1} max={1000000} step={1} required value={draft.quantity} onChange={(event) => set({ quantity: event.target.value })} /></label>
        <label className="form-field">Priorità *
          <select className="input" value={draft.priority} onChange={(event) => set({ priority: event.target.value })}>{PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}</select>
        </label>
        <label className="form-field">Richiedente *<input className="input" required minLength={2} maxLength={160} value={draft.requester} onChange={(event) => set({ requester: event.target.value })} /></label>
        <label className="form-field warehouse-form__wide">Motivo<textarea className="input" rows={2} maxLength={1000} value={draft.reason} onChange={(event) => set({ reason: event.target.value })} placeholder="A cosa serve e per quale progetto" /></label>
        <label className="form-field">Fornitore<input className="input" maxLength={160} value={draft.supplier} onChange={(event) => set({ supplier: event.target.value })} /></label>
        <label className="form-field">Costo stimato (€)<input className="input" type="number" min={0} step={0.01} value={draft.cost} onChange={(event) => set({ cost: event.target.value })} /></label>
        <p className="warehouse-form__wide warehouse-footnote">L'ID richiesta viene assegnato dal sistema e lo stato iniziale è «Da valutare».</p>
        {save.error && <p className="form-error warehouse-form__wide" role="alert">{inventoryErrorMessage(save.error)}</p>}
        <div className="form-actions warehouse-form__wide"><button className="button button--primary" disabled={save.isPending}>{save.isPending ? "Invio…" : "Invia richiesta"}</button><button className="button button--secondary" type="button" onClick={onClose}>Annulla</button></div>
      </form>
    </Modal>
  );
}

function StatusModal({ api, request, onClose }: { api: InventoryApi; request: PurchaseRequest; onClose: () => void }) {
  const current = PURCHASE_FLOW.indexOf(request.status);
  const closed = request.status === "Ricevuto" || request.status === "Annullato";
  const choices = closed ? [request.status] : [...PURCHASE_FLOW.slice(Math.max(current, 0)), "Annullato"];
  const [status, setStatus] = useState(request.status);
  const [orderDate, setOrderDate] = useState(request.order_date ?? "");
  const [receivedDate, setReceivedDate] = useState(request.received_date ?? "");
  const [notes, setNotes] = useState(request.notes);
  const needsOrder = status === "Ordinato" || status === "In consegna" || status === "Ricevuto";
  const needsReceived = status === "Ricevuto";
  const save = useMutation({
    mutationFn: () => api.write("inventory_update_purchase_request", {
      p_id: request.id, p_status: status, p_order_date: needsOrder ? orderDate || null : request.order_date,
      p_received_date: needsReceived ? receivedDate || null : request.received_date, p_notes: notes,
    }),
    onSuccess: onClose,
  });
  return (
    <Modal title={`${request.code} · ${request.material}`} onClose={onClose}>
      <form className="warehouse-form" onSubmit={(event: FormEvent) => { event.preventDefault(); save.mutate(); }}>
        <label className="form-field warehouse-form__wide">Stato
          <select className="input" value={status} disabled={closed} onChange={(event) => setStatus(event.target.value)}>{choices.map((choice) => <option key={choice}>{choice}</option>)}</select>
          <small>{{ "Da valutare": "In attesa di approvazione interna/logistica.", Approvato: "Richiesta validata.", Ordinato: "Ordine inoltrato al fornitore: serve la data dell'ordine.", "In consegna": "Spedizione in transito.", Ricevuto: "Merce arrivata in sede: serve la data di ricezione.", Annullato: "Richiesta annullata: non potrà più essere modificata." }[status]}</small>
        </label>
        {needsOrder && <label className="form-field">Data ordine *<input className="input" type="date" required max={todayIso()} value={orderDate} onChange={(event) => setOrderDate(event.target.value)} /></label>}
        {needsReceived && <label className="form-field">Data ricezione *<input className="input" type="date" required min={orderDate || undefined} max={todayIso()} value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} /></label>}
        <label className="form-field warehouse-form__wide">Note<textarea className="input" rows={2} maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        {needsReceived && !closed && <p className="warehouse-form__wide warehouse-footnote">Dopo aver salvato, usa «Inserisci in magazzino» sulla riga: l'articolo viene creato in Inventario e l'Entrata si registra nei Movimenti.</p>}
        {save.error && <p className="form-error warehouse-form__wide" role="alert">{inventoryErrorMessage(save.error)}</p>}
        <div className="form-actions warehouse-form__wide"><button className="button button--primary" disabled={save.isPending || closed}>{save.isPending ? "Salvataggio…" : "Aggiorna richiesta"}</button><button className="button button--secondary" type="button" onClick={onClose}>Chiudi</button></div>
      </form>
    </Modal>
  );
}

export function PurchasesTab({ api }: { api: InventoryApi }) {
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState<PurchaseRequest | null>(null);
  const [receiving, setReceiving] = useState<PurchaseRequest | null>(null);
  const [status, setStatus] = useState("open");
  const requests = useMemo(() => api.purchases.data ?? [], [api.purchases.data]);
  const items = api.items.data ?? [];

  const cancel = useMutation({
    mutationFn: (request: PurchaseRequest) => api.write("inventory_update_purchase_request", { p_id: request.id, p_status: "Annullato", p_order_date: null, p_received_date: null, p_notes: request.notes }),
  });

  const rows = useMemo(() => requests.filter((request) => {
    if (status === "all") return true;
    if (status === "open") return request.status !== "Ricevuto" && request.status !== "Annullato";
    return request.status === status;
  }), [requests, status]);
  const toStore = requests.filter((request) => request.status === "Ricevuto" && !request.item_id);

  const prefillFor = (request: PurchaseRequest): ItemPrefill => ({
    area: request.area, name: request.material, quantity: String(request.quantity), supplier: request.supplier, project_use: request.reason.slice(0, 240),
    unit_cost: request.estimated_cost != null ? String(Math.round((request.estimated_cost / request.quantity) * 100) / 100) : "",
    purchase_date: request.received_date ?? "", purchaseRequestId: request.id, purchaseCode: request.code,
  });

  return (
    <section className="panel panel__body warehouse-section">
      <header className="warehouse-section__header">
        <div><p className="eyebrow">Workflow richieste</p><h2><ShoppingCart size={20} /> Acquisti</h2><p>Dalla richiesta alla ricezione: Da valutare → Approvato → Ordinato → In consegna → Ricevuto.</p></div>
        <button className="button button--primary" type="button" onClick={() => setCreating(true)}><Plus size={16} /> Nuova richiesta</button>
      </header>
      {api.canManage && toStore.length > 0 && <p className="form-success" role="status"><PackageCheck size={16} /> {toStore.length === 1 ? "1 richiesta ricevuta" : `${toStore.length} richieste ricevute`} da inserire in magazzino: usa «Inserisci in magazzino» sulla riga.</p>}
      <div className="warehouse-filters">
        <label><span className="sr-only">Stato</span>
          <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="open">In corso</option><option value="all">Tutte</option>{[...PURCHASE_FLOW, "Annullato"].map((entry) => <option key={entry}>{entry}</option>)}
          </select>
        </label>
        <span>{rows.length} {rows.length === 1 ? "richiesta" : "richieste"}</span>
      </div>
      {cancel.error && <p className="form-error" role="alert">{inventoryErrorMessage(cancel.error)}</p>}
      {api.purchases.isLoading ? <p>Caricamento richieste…</p> : rows.length === 0 ? (
        <div className="warehouse-empty"><ShoppingCart size={28} /><strong>Nessuna richiesta</strong><span>Un Capo Area può inserire una richiesta di acquisto con «Nuova richiesta».</span></div>
      ) : (
        <div className="warehouse-history-wrap">
          <table className="warehouse-history warehouse-sheet">
            <thead><tr><th>ID richiesta</th><th>Data richiesta</th><th>Materiale</th><th>Area</th><th>Quantità</th><th>Priorità</th><th>Richiedente</th><th>Motivo</th><th>Fornitore</th><th>Costo stimato</th><th>Stato</th><th>Data ordine</th><th>Data ricezione</th><th>Azioni</th></tr></thead>
            <tbody>{rows.map((request) => {
              const linked = items.find((item) => item.id === request.item_id);
              const mine = request.requester_user_id === api.access?.userId;
              return (
                <tr key={request.id}>
                  <td><strong>{request.code}</strong></td><td>{formatDate(request.request_date)}</td><td><strong>{request.material}</strong><small>{request.notes}</small></td>
                  <td>{AREA_LABELS[request.area]}</td><td>{request.quantity}</td><td>{request.priority}</td><td>{request.requester_name}</td><td>{request.reason || "—"}</td><td>{request.supplier || "—"}</td>
                  <td>{request.estimated_cost != null ? euro.format(request.estimated_cost) : "—"}</td><td><strong>{request.status}</strong>{linked && <small>In magazzino: {linked.sku}</small>}</td>
                  <td>{formatDate(request.order_date)}</td><td>{formatDate(request.received_date)}</td>
                  <td className="warehouse-sheet__actions">
                    {api.canManage && request.status !== "Annullato" && !(request.status === "Ricevuto") && <button className="button button--secondary button--small" type="button" onClick={() => setUpdating(request)}>Aggiorna stato</button>}
                    {api.canManage && request.status === "Ricevuto" && !request.item_id && <button className="button button--primary button--small" type="button" onClick={() => setReceiving(request)}><PackageCheck size={14} /> Inserisci in magazzino</button>}
                    {!api.canManage && mine && request.status === "Da valutare" && <button className="button button--secondary button--small" type="button" disabled={cancel.isPending} onClick={() => cancel.mutate(request)}>Annulla richiesta</button>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      {creating && <RequestModal api={api} onClose={() => setCreating(false)} />}
      {updating && <StatusModal api={api} request={updating} onClose={() => setUpdating(null)} />}
      {receiving && <ItemFormModal api={api} prefill={prefillFor(receiving)} onClose={() => setReceiving(null)} />}
    </section>
  );
}
