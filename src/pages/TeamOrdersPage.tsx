import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Download, FileText, History, Plus, ReceiptText, Save, Search, X } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "../lib/supabase";

type PurchaseOrder = {
  id: string; requester_user_id: string; requester_first_name: string; requester_last_name: string;
  vendor_name: string; description: string; order_date: string; amount: number;
  status: "ordered" | "received" | "cancelled"; invoice_path: string; notes: string;
  created_at: string; updated_at: string;
};
type Audit = { id: number; event_type: string; actor_name: string; after_data: Record<string, unknown>; created_at: string };
type Draft = Omit<PurchaseOrder, "id" | "requester_user_id" | "created_at" | "updated_at">;
const initialDraft = (displayName: string): Draft => {
  const [first = "", ...last] = displayName.trim().split(/\s+/);
  return { requester_first_name: first, requester_last_name: last.join(" "), vendor_name: "", description: "", order_date: new Date().toISOString().slice(0, 10), amount: 0, status: "ordered", invoice_path: "", notes: "" };
};
const statusLabels = { ordered: "Ordinato", received: "Ricevuto", cancelled: "Annullato" } as const;
const money = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function exportOrders(rows: PurchaseOrder[]) {
  const columns: (keyof PurchaseOrder)[] = ["order_date", "requester_first_name", "requester_last_name", "vendor_name", "description", "amount", "status", "notes"];
  const header = ["Data ordine", "Nome", "Cognome", "Fornitore", "Materiale / descrizione", "Prezzo €", "Stato", "Note"];
  const lines = [header, ...rows.map((row) => columns.map((key) => key === "status" ? statusLabels[row.status] : row[key]))]
    .map((line) => line.map(csvCell).join(";"));
  const url = URL.createObjectURL(new Blob(["\ufeff", lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = `ordini-team-galileo-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
}

export function TeamOrdersPage() {
  const { access } = useAuth();
  const cache = useQueryClient();
  const canManage = Boolean(access?.isTeamLeader || access?.areas.some((area) => area.slug === "logistica"));
  const [draft, setDraft] = useState<(Draft & { id?: string }) | null>(null);
  const [queryText, setQueryText] = useState("");
  const [filter, setFilter] = useState("all");
  const [historyId, setHistoryId] = useState<string | null>(null);
  const orders = useQuery({ queryKey: ["team-purchase-orders"], enabled: canManage, queryFn: async () => {
    const { data, error } = await supabase.from("team_purchase_orders").select("*").order("order_date", { ascending: false }).order("created_at", { ascending: false });
    if (error) throw error; return data as PurchaseOrder[];
  }});
  const audit = useQuery({ queryKey: ["team-purchase-order-audit", historyId], enabled: canManage && Boolean(historyId), queryFn: async () => {
    const { data, error } = await supabase.from("team_purchase_order_audit").select("*").eq("order_id", historyId!).order("id", { ascending: false }).limit(30);
    if (error) throw error; return data as Audit[];
  }});
  const save = useMutation({ mutationFn: async () => {
    if (!draft || !access) return;
    const { id, ...payload } = draft;
    const row = { ...payload, amount: Number(payload.amount) };
    const result = id
      ? await supabase.from("team_purchase_orders").update(row).eq("id", id)
      : await supabase.from("team_purchase_orders").insert({ ...row, requester_user_id: access.userId });
    if (result.error) throw result.error;
  }, onSuccess: () => { setDraft(null); void cache.invalidateQueries({ queryKey: ["team-purchase-orders"] }); }});
  const uploadInvoice = useMutation({ mutationFn: async ({ order, file }: { order: PurchaseOrder; file: File }) => {
    if (!new Set(["application/pdf", "image/jpeg", "image/png"]).has(file.type) || file.size > 15 * 1024 * 1024) throw new Error("Carica una fattura PDF o un’immagine JPG/PNG fino a 15 MB.");
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${order.id}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from("team-order-invoices").upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    const { error } = await supabase.from("team_purchase_orders").update({ invoice_path: path }).eq("id", order.id);
    if (error) { await supabase.storage.from("team-order-invoices").remove([path]); throw error; }
    if (order.invoice_path) await supabase.storage.from("team-order-invoices").remove([order.invoice_path]);
  }, onSuccess: () => { void cache.invalidateQueries({ queryKey: ["team-purchase-orders"] }); void cache.invalidateQueries({ queryKey: ["team-purchase-order-audit"] }); }});
  const openInvoice = async (path: string) => {
    const { data, error } = await supabase.storage.from("team-order-invoices").createSignedUrl(path, 60);
    if (error) throw error;
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };
  const rows = (orders.data ?? []).filter((order) => {
    const search = `${order.vendor_name} ${order.description} ${order.requester_first_name} ${order.requester_last_name}`.toLocaleLowerCase("it");
    return search.includes(queryText.trim().toLocaleLowerCase("it")) && (filter === "all" || order.status === filter);
  });
  const ordered = (orders.data ?? []).filter((order) => order.status === "ordered").length;
  const spent = (orders.data ?? []).filter((order) => order.status !== "cancelled").reduce((sum, order) => sum + Number(order.amount), 0);
  const error = orders.error ?? audit.error ?? save.error ?? uploadInvoice.error;

  if (!canManage) return <div className="page-container"><PageHeader title="Ordini" eyebrow="Accesso riservato" description="Sezione disponibile a Logistica, Capo Logistica e Team Leader." /></div>;
  return <div className="page-container team-orders-page">
    <PageHeader title="Ordini" eyebrow="Acquisti del team" description="Registra gli acquisti di materiali e componenti, allega le fatture e tieni traccia di chi ha effettuato l’ordine." />
    {error && <p className="form-error" role="alert">{error instanceof Error ? error.message : "Operazione non riuscita."}</p>}
    <div className="team-order-stats"><article><span>Da ricevere</span><strong>{ordered}</strong></article><article><span>Totale ordini attivi</span><strong>{money.format(spent)}</strong></article><article><span>Ordini registrati</span><strong>{(orders.data ?? []).length}</strong></article></div>
    <section className="panel panel__body team-order-section">
      <header className="team-order-toolbar"><div><h2><ReceiptText size={19}/> Registro acquisti</h2><p>Ogni ordine conserva referente, fornitore, data, importo e fattura.</p></div><div className="team-order-toolbar__actions"><button className="button button--secondary" type="button" onClick={() => exportOrders(orders.data ?? [])}><Download size={16}/> Esporta CSV</button><button className="button button--primary" type="button" onClick={() => setDraft(initialDraft(access?.displayName ?? ""))}><Plus size={16}/> Registra ordine</button></div></header>
      <div className="team-order-filters"><label className="team-order-search"><Search size={16}/><input className="input" value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder="Cerca fornitore, articolo o referente" aria-label="Cerca ordini"/></label><select className="input" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filtra ordini"><option value="all">Tutti gli stati</option><option value="ordered">Ordinati</option><option value="received">Ricevuti</option><option value="cancelled">Annullati</option></select><span>{rows.length} {rows.length === 1 ? "ordine" : "ordini"}</span></div>
      {orders.isLoading ? <p>Caricamento ordini…</p> : rows.length === 0 ? <div className="team-order-empty"><ClipboardList size={25}/><strong>Nessun ordine registrato</strong><span>Registra il primo acquisto del team per tenere insieme importi e fatture.</span></div> : <div className="team-order-list">{rows.map((order) => <article className="team-order-card" key={order.id}>
        <div className="team-order-card__main"><div className="team-order-card__title"><h3>{order.vendor_name}</h3><span className={`team-order-badge team-order-badge--${order.status}`}>{statusLabels[order.status]}</span></div><p className="team-order-card__description">{order.description}</p><div className="team-order-meta"><span>Referente: <strong>{order.requester_first_name} {order.requester_last_name}</strong></span><span>Data: <strong>{new Date(`${order.order_date}T12:00:00`).toLocaleDateString("it-IT")}</strong></span>{order.notes && <span>Note: {order.notes}</span>}</div></div>
        <div className="team-order-card__amount"><strong>{money.format(Number(order.amount))}</strong><span>{order.invoice_path ? "Fattura allegata" : "Fattura da caricare"}</span></div>
        <div className="team-order-card__actions"><button className="button button--secondary button--small" type="button" onClick={() => setDraft({ id: order.id, requester_first_name: order.requester_first_name, requester_last_name: order.requester_last_name, vendor_name: order.vendor_name, description: order.description, order_date: order.order_date, amount: order.amount, status: order.status, invoice_path: order.invoice_path, notes: order.notes })}>Modifica</button>{order.invoice_path ? <button className="button button--secondary button--small" type="button" onClick={() => void openInvoice(order.invoice_path)}><FileText size={15}/> Apri fattura</button> : <label className="button button--secondary button--small team-order-upload"><ReceiptText size={15}/> Carica fattura<input type="file" accept="application/pdf,image/png,image/jpeg" disabled={uploadInvoice.isPending} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) uploadInvoice.mutate({ order, file }); event.currentTarget.value = ""; }}/></label>}<button className="button button--secondary button--small" type="button" onClick={() => setHistoryId(historyId === order.id ? null : order.id)}><History size={15}/> Storico</button></div>
        {historyId === order.id && <div className="team-order-history"><h4>Storico ordine</h4>{audit.isLoading ? <p>Caricamento…</p> : audit.data?.length ? <ol>{audit.data.map((item) => <li key={item.id}><strong>{item.event_type === "created" ? "Ordine registrato" : "Ordine aggiornato"}</strong><span>{item.actor_name} · {new Date(item.created_at).toLocaleString("it-IT")}</span><details><summary>Vedi i dettagli</summary><pre>{JSON.stringify(item.after_data, null, 2)}</pre></details></li>)}</ol> : <p>Nessuna modifica registrata.</p>}</div>}
      </article>)}</div>}
    </section>
    {draft && <div className="sponsor-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDraft(null); }}><section className="panel sponsor-modal" role="dialog" aria-modal="true" aria-labelledby="team-order-editor-title"><header><div><p className="eyebrow">Acquisto del team</p><h2 id="team-order-editor-title">{draft.id ? "Modifica ordine" : "Registra ordine"}</h2></div><button className="icon-button" type="button" aria-label="Chiudi" onClick={() => setDraft(null)}><X size={18}/></button></header><form className="sponsor-form" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <label className="form-field">Nome di chi ha ordinato *<input className="input" required minLength={1} maxLength={100} value={draft.requester_first_name} onChange={(event) => setDraft({ ...draft, requester_first_name: event.target.value })}/></label><label className="form-field">Cognome *<input className="input" required minLength={1} maxLength={100} value={draft.requester_last_name} onChange={(event) => setDraft({ ...draft, requester_last_name: event.target.value })}/></label>
      <label className="form-field">Fornitore / azienda *<input className="input" required minLength={2} maxLength={180} value={draft.vendor_name} onChange={(event) => setDraft({ ...draft, vendor_name: event.target.value })} placeholder="Nome del fornitore"/></label><label className="form-field">Data ordine *<input className="input" type="date" required value={draft.order_date} onChange={(event) => setDraft({ ...draft, order_date: event.target.value })}/></label>
      <label className="form-field sponsor-form__wide">Materiale e dettagli dell’ordine *<textarea className="input" rows={3} required minLength={2} maxLength={5000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Articoli, quantità, codici o specifiche"/></label>
      <label className="form-field">Prezzo totale (€) *<input className="input" type="number" required min="0" max="100000000" step="0.01" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: Number(event.target.value) })}/></label><label className="form-field">Stato<select className="input" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Draft["status"] })}><option value="ordered">Ordinato</option><option value="received">Ricevuto</option><option value="cancelled">Annullato</option></select></label>
      <label className="form-field sponsor-form__wide">Note<textarea className="input" rows={2} maxLength={3000} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })}/></label>
      {save.error && <p className="form-error sponsor-form__wide" role="alert">{save.error.message}</p>}<footer className="sponsor-form__actions"><button className="button button--secondary" type="button" onClick={() => setDraft(null)}>Annulla</button><button className="button button--primary" disabled={save.isPending}><Save size={16}/>{save.isPending ? "Salvataggio…" : "Salva ordine"}</button></footer>
    </form></section></div>}
  </div>;
}

