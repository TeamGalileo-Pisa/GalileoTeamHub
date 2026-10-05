import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeEuro, Check, CirclePlus, Clock3, Download, FileText, History, Paperclip, Save, X } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "../lib/supabase";

type BudgetEntry = {
  id: string; title: string; category: string; area_id: string | null; entry_type: "expense" | "income";
  budgeted_amount: number; actual_amount: number; payment_status: "unpaid" | "partial" | "paid";
  approval_status: "pending" | "approved" | "rejected"; due_date: string | null; paid_at: string | null;
  document_path: string; notes: string; created_by: string; approved_by: string | null; approved_at: string | null;
  created_at: string; updated_at: string;
};
type Audit = { id: number; entry_id: string; event_type: string; actor_name: string; before_data: Record<string, unknown> | null; after_data: Record<string, unknown>; created_at: string };
type Area = { id: string; name: string; slug: string };
type Draft = Omit<BudgetEntry, "id" | "created_by" | "approved_by" | "approved_at" | "created_at" | "updated_at"> & { id?: string };
const blank: Draft = { title: "", category: "", area_id: null, entry_type: "expense", budgeted_amount: 0, actual_amount: 0, payment_status: "unpaid", approval_status: "pending", due_date: null, paid_at: null, document_path: "", notes: "" };
const euro = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const approvalLabel = { pending: "In approvazione", approved: "Approvato", rejected: "Respinto" } as const;
const paymentLabel = { unpaid: "Da pagare", partial: "Parziale", paid: "Pagato" } as const;
function cell(value: unknown) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
function exportBudget(rows: BudgetEntry[], areas: Area[]) {
  const header = ["Voce", "Categoria", "Area", "Tipo", "Preventivo €", "Consuntivo €", "Approvazione", "Pagamento", "Scadenza", "Data pagamento", "Note"];
  const body = rows.map((r) => [r.title, r.category, areas.find((a) => a.id === r.area_id)?.name ?? "Generale", r.entry_type === "expense" ? "Uscita" : "Entrata", r.budgeted_amount, r.actual_amount, approvalLabel[r.approval_status], paymentLabel[r.payment_status], r.due_date, r.paid_at, r.notes]);
  const csv = [header, ...body].map((line) => line.map(cell).join(";")).join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" })); a.download = `budget-galileo-${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

export function BudgetPage() {
  const { access } = useAuth();
  const cache = useQueryClient();
  const canManage = Boolean(access?.isTeamLeader || (!access?.isMember && access?.areas.some((a) => a.slug === "business")));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [filter, setFilter] = useState("all");
  const [historyId, setHistoryId] = useState<string | null>(null);
  const areas = useQuery({ queryKey: ["budget-areas"], enabled: canManage, queryFn: async () => {
    const { data, error } = await supabase.from("areas").select("id,name,slug").eq("active", true).order("name");
    if (error) throw error; return data as Area[];
  }});
  const entries = useQuery({ queryKey: ["budget-entries"], enabled: canManage, queryFn: async () => {
    const { data, error } = await supabase.from("budget_entries").select("*").order("created_at", { ascending: false });
    if (error) throw error; return data as BudgetEntry[];
  }});
  const audit = useQuery({ queryKey: ["budget-audit", historyId], enabled: canManage && Boolean(historyId), queryFn: async () => {
    const { data, error } = await supabase.from("budget_audit_log").select("*").eq("entry_id", historyId!).order("id", { ascending: false }).limit(40);
    if (error) throw error; return data as Audit[];
  }});
  const save = useMutation({ mutationFn: async () => {
    if (!draft || !access) return;
    const payload = { ...draft, budgeted_amount: Number(draft.budgeted_amount), actual_amount: Number(draft.actual_amount) };
    const result = draft.id ? await supabase.from("budget_entries").update(payload).eq("id", draft.id) : await supabase.from("budget_entries").insert({ ...payload, created_by: access.userId });
    if (result.error) throw result.error;
  }, onSuccess: () => { setDraft(null); void cache.invalidateQueries({ queryKey: ["budget-entries"] }); }});
  const approve = useMutation({ mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => {
    const { error } = await supabase.from("budget_entries").update({ approval_status: status }).eq("id", id);
    if (error) throw error;
  }, onSuccess: () => { void cache.invalidateQueries({ queryKey: ["budget-entries"] }); void cache.invalidateQueries({ queryKey: ["budget-audit"] }); }});
  const setPayment = useMutation({ mutationFn: async ({ row, status }: { row: BudgetEntry; status: BudgetEntry["payment_status"] }) => {
    const { error } = await supabase.from("budget_entries").update({ payment_status: status, paid_at: status === "paid" ? new Date().toISOString().slice(0,10) : null }).eq("id", row.id);
    if (error) throw error;
  }, onSuccess: () => { void cache.invalidateQueries({ queryKey: ["budget-entries"] }); void cache.invalidateQueries({ queryKey: ["budget-audit"] }); }});
  const attach = useMutation({ mutationFn: async ({ row, file }: { row: BudgetEntry; file: File }) => {
    if (!access) throw new Error("Sessione non valida.");
    if (!new Set(["application/pdf", "image/jpeg", "image/png"]).has(file.type) || file.size > 10 * 1024 * 1024) throw new Error("Carica un PDF o un’immagine PNG/JPG fino a 10 MB.");
    const path = `${access.userId}/${row.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error: uploadError } = await supabase.storage.from("budget-documents").upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    const { error } = await supabase.from("budget_entries").update({ document_path: path }).eq("id", row.id);
    if (error) { await supabase.storage.from("budget-documents").remove([path]); throw error; }
  }, onSuccess: () => { void cache.invalidateQueries({ queryKey: ["budget-entries"] }); void cache.invalidateQueries({ queryKey: ["budget-audit"] }); }});
  const openDocument = async (path: string) => {
    const { data, error } = await supabase.storage.from("budget-documents").createSignedUrl(path, 60);
    if (error) throw error;
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };
  const list = entries.data ?? [];
  const rows = list.filter((r) => filter === "all" || r.approval_status === filter || r.payment_status === filter);
  const planned = list.filter((r) => r.entry_type === "expense" && r.approval_status !== "rejected").reduce((s,r) => s + Number(r.budgeted_amount), 0);
  const actual = list.filter((r) => r.entry_type === "expense" && r.approval_status === "approved").reduce((s,r) => s + Number(r.actual_amount), 0);
  const unpaid = list.filter((r) => r.payment_status !== "paid" && r.approval_status === "approved").reduce((s,r) => s + Number(r.actual_amount || r.budgeted_amount), 0);
  const error = areas.error ?? entries.error ?? audit.error ?? save.error ?? approve.error ?? setPayment.error ?? attach.error;

  if (!canManage) return <div className="page-container"><PageHeader title="Budget" eyebrow="Accesso riservato" description="Questa sezione è disponibile al Team Leader e al Capo Business." /></div>;

  return <div className="page-container budget-page">
    <PageHeader title="Budget" eyebrow="Team Leader · Capo Business" description="Monitora preventivi, spese reali, approvazioni, pagamenti e documenti in un registro con storico delle modifiche." />
    {error && <p className="form-error" role="alert">{error instanceof Error ? error.message : "Operazione non riuscita."}</p>}
    <div className="budget-stats"><article className="budget-stat"><span>Preventivato · uscite</span><strong>{euro.format(planned)}</strong></article><article className="budget-stat"><span>Consuntivo approvato</span><strong>{euro.format(actual)}</strong></article><article className="budget-stat budget-stat--due"><span>Da saldare</span><strong>{euro.format(unpaid)}</strong></article></div>
    <section className="panel panel__body budget-section">
      <header className="budget-toolbar"><div><h2><BadgeEuro size={19}/> Registro budget</h2><p>Le nuove voci richiedono approvazione prima di entrare nel consuntivo.</p></div><div className="budget-toolbar__actions"><button className="button button--secondary" onClick={() => exportBudget(list, areas.data ?? [])} type="button"><Download size={16}/> Esporta CSV</button><button className="button button--primary" onClick={() => setDraft({...blank})} type="button"><CirclePlus size={16}/> Nuova voce</button></div></header>
      <div className="budget-filters"><label>Mostra<select className="input" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">Tutte le voci</option><option value="pending">Da approvare</option><option value="approved">Approvate</option><option value="rejected">Respinte</option><option value="unpaid">Da pagare</option><option value="partial">Pagate in parte</option><option value="paid">Pagate</option></select></label><span>{rows.length} {rows.length === 1 ? "voce" : "voci"}</span></div>
      {entries.isLoading ? <p>Caricamento budget…</p> : rows.length === 0 ? <div className="budget-empty"><BadgeEuro size={24}/><strong>Il registro è vuoto</strong><span>Aggiungi una spesa prevista o un’entrata per iniziare il monitoraggio.</span></div> : <div className="budget-list">{rows.map((row) => <article className="budget-card" key={row.id}>
        <div className="budget-card__main"><div className="budget-card__title"><h3>{row.title}</h3><span className={`budget-badge budget-badge--${row.approval_status}`}>{approvalLabel[row.approval_status]}</span><span className={`budget-badge budget-badge--pay-${row.payment_status}`}>{paymentLabel[row.payment_status]}</span></div><p>{row.category} · {areas.data?.find((a) => a.id === row.area_id)?.name ?? "Generale"} · {row.entry_type === "expense" ? "Uscita" : "Entrata"}</p>{row.notes && <p className="budget-card__notes">{row.notes}</p>}{row.due_date && <small><Clock3 size={13}/> Scadenza: {new Date(`${row.due_date}T12:00:00`).toLocaleDateString("it-IT")}</small>}</div>
        <div className="budget-card__amount"><strong>{euro.format(Number(row.actual_amount))}</strong><span>effettivi · preventivo {euro.format(Number(row.budgeted_amount))}</span></div>
        <div className="budget-card__actions">{row.approval_status === "pending" && row.created_by !== access?.userId && <><button className="button button--primary button--small" disabled={approve.isPending} onClick={() => approve.mutate({id:row.id,status:"approved"})}><Check size={15}/> Approva</button><button className="button button--secondary button--small" disabled={approve.isPending} onClick={() => approve.mutate({id:row.id,status:"rejected"})}>Respingi</button></>}{row.approval_status === "approved" && <select className="input budget-payment-select" aria-label={`Stato pagamento ${row.title}`} value={row.payment_status} onChange={(e) => setPayment.mutate({row,status:e.target.value as BudgetEntry["payment_status"]})}><option value="unpaid">Da pagare</option><option value="partial">Parziale</option><option value="paid">Pagato</option></select>}<button className="button button--secondary button--small" onClick={() => setDraft({...row})}>Modifica</button>{row.document_path ? <button className="button button--secondary button--small" onClick={() => void openDocument(row.document_path)}><FileText size={15}/> Documento</button> : row.approval_status !== "rejected" && <label className="button button--secondary button--small budget-upload"><Paperclip size={15}/> Allega<input type="file" accept="application/pdf,image/png,image/jpeg" disabled={attach.isPending} onChange={(e) => {const file=e.target.files?.[0]; if(file) attach.mutate({row,file}); e.currentTarget.value="";}}/></label>}<button className="button button--secondary button--small" onClick={() => setHistoryId(historyId===row.id?null:row.id)}><History size={15}/> Storico</button></div>
        {historyId === row.id && <div className="budget-history"><h4>Storico modifiche</h4>{audit.isLoading ? <p>Caricamento…</p> : audit.data?.length ? <ol>{audit.data.map((item) => <li key={item.id}><strong>{item.event_type === "created" ? "Voce creata" : "Aggiornamento"}</strong><span>{item.actor_name} · {new Date(item.created_at).toLocaleString("it-IT")}</span><details><summary>Vedi i dettagli</summary><pre>{JSON.stringify(item.after_data, null, 2)}</pre></details></li>)}</ol> : <p>Nessuna modifica registrata.</p>}</div>}
      </article>)}</div>}
    </section>
    {draft && <div className="sponsor-modal-backdrop" role="presentation" onMouseDown={(e) => {if(e.target===e.currentTarget)setDraft(null);}}><section className="panel sponsor-modal" role="dialog" aria-modal="true" aria-labelledby="budget-editor-title"><header><div><p className="eyebrow">Registro economico</p><h2 id="budget-editor-title">{draft.id ? "Modifica voce" : "Nuova voce budget"}</h2></div><button className="icon-button" aria-label="Chiudi" type="button" onClick={() => setDraft(null)}><X size={18}/></button></header><form className="sponsor-form" onSubmit={(e) => {e.preventDefault();save.mutate();}}>
      <label className="form-field sponsor-form__wide">Descrizione *<input className="input" required minLength={2} maxLength={180} value={draft.title} onChange={(e) => setDraft({...draft,title:e.target.value})} placeholder="Es. Componenti elettronici rover"/></label>
      <label className="form-field">Categoria *<input className="input" required minLength={2} maxLength={100} value={draft.category} onChange={(e) => setDraft({...draft,category:e.target.value})} placeholder="Materiali, trasferte…"/></label><label className="form-field">Area<select className="input" value={draft.area_id ?? ""} onChange={(e) => setDraft({...draft,area_id:e.target.value||null})}><option value="">Generale / Team</option>{areas.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label className="form-field">Tipo<select className="input" value={draft.entry_type} onChange={(e) => setDraft({...draft,entry_type:e.target.value as Draft["entry_type"]})}><option value="expense">Uscita</option><option value="income">Entrata</option></select></label><label className="form-field">Importo previsto (€)<input className="input" type="number" min="0" step="0.01" value={draft.budgeted_amount} onChange={(e) => setDraft({...draft,budgeted_amount:Number(e.target.value)})}/></label>
      <label className="form-field">Consuntivo attuale (€)<input className="input" type="number" min="0" step="0.01" value={draft.actual_amount} onChange={(e) => setDraft({...draft,actual_amount:Number(e.target.value)})}/></label><label className="form-field">Stato pagamento<select className="input" value={draft.payment_status} onChange={(e) => setDraft({...draft,payment_status:e.target.value as Draft["payment_status"]})}><option value="unpaid">Da pagare</option><option value="partial">Parziale</option><option value="paid">Pagato</option></select></label>
      <label className="form-field">Scadenza<input className="input" type="date" value={draft.due_date ?? ""} onChange={(e) => setDraft({...draft,due_date:e.target.value||null})}/></label>{draft.id && <label className="form-field">Data pagamento<input className="input" type="date" value={draft.paid_at ?? ""} onChange={(e) => setDraft({...draft,paid_at:e.target.value||null})}/></label>}
      <label className="form-field sponsor-form__wide">Note<textarea className="input" rows={3} maxLength={5000} value={draft.notes} onChange={(e) => setDraft({...draft,notes:e.target.value})}/></label>
      {!draft.id && <p className="budget-approval-note sponsor-form__wide"><Clock3 size={15}/> La voce sarà salvata come “In approvazione”. L’approvazione deve essere data da un altro utente autorizzato.</p>}
      {save.error && <p className="form-error sponsor-form__wide" role="alert">{save.error.message}</p>}<footer className="sponsor-form__actions"><button className="button button--secondary" type="button" onClick={() => setDraft(null)}>Annulla</button><button className="button button--primary" disabled={save.isPending}><Save size={16}/>{save.isPending ? "Salvataggio…" : "Salva voce"}</button></footer>
    </form></section></div>}
  </div>;
}

