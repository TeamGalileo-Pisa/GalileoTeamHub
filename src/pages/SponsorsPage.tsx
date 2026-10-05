import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Building2, CalendarClock, CirclePlus, History, Mail, Phone, Save, Search, UsersRound, X } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "../lib/supabase";

type Sponsor = {
  id: string; organization_name: string; contact_name: string; email: string; phone: string;
  status: "prospect" | "contacted" | "proposal" | "negotiation" | "active" | "closed_lost";
  contribution_type: "cash" | "in_kind" | "mixed"; pledged_cash: number; received_cash: number;
  in_kind_description: string; estimated_in_kind_value: number; owner_name: string;
  next_follow_up: string | null; renewal_date: string | null; notes: string; archived_at: string | null;
  created_by: string; created_at: string; updated_at: string;
};
type Interaction = { id: number; sponsor_id: string; interaction_type: string; summary: string; actor_name: string; happened_at: string };
type SponsorDraft = Omit<Sponsor, "id" | "archived_at" | "created_by" | "created_at" | "updated_at"> & { id?: string };
const blank: SponsorDraft = { organization_name: "", contact_name: "", email: "", phone: "", status: "prospect", contribution_type: "cash", pledged_cash: 0, received_cash: 0, in_kind_description: "", estimated_in_kind_value: 0, owner_name: "", next_follow_up: null, renewal_date: null, notes: "" };
const stages: Record<Sponsor["status"], string> = { prospect: "Da contattare", contacted: "Contattato", proposal: "Proposta inviata", negotiation: "In trattativa", active: "Attivo", closed_lost: "Non proseguito" };
const euro = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });

function csvCell(value: unknown) { const s = value == null ? "" : String(value); return `"${s.replaceAll('"', '""')}"`; }
function exportSponsors(rows: Sponsor[]) {
  const cols: (keyof Sponsor)[] = ["organization_name", "contact_name", "email", "phone", "status", "contribution_type", "pledged_cash", "received_cash", "in_kind_description", "estimated_in_kind_value", "owner_name", "next_follow_up", "renewal_date", "notes"];
  const labels = ["Organizzazione", "Contatto", "Email", "Telefono", "Fase", "Contributo", "Promesso €", "Ricevuto €", "Materiali/servizi", "Valore materiali €", "Responsabile", "Prossimo contatto", "Rinnovo", "Note"];
  const body = [labels, ...rows.map((r) => cols.map((k) => k === "status" ? stages[r.status] : r[k]))].map((line) => line.map(csvCell).join(";"));
  const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob(["\ufeff", body.join("\r\n")], { type: "text/csv;charset=utf-8" })); link.download = `sponsor-galileo-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(link.href);
}

export function SponsorsPage() {
  const { access } = useAuth();
  const cache = useQueryClient();
  const canManage = Boolean(access?.isTeamLeader || access?.areas.some((a) => a.slug === "logistica"));
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("all");
  const [draft, setDraft] = useState<SponsorDraft | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [interactionType, setInteractionType] = useState("email");
  const [interactionText, setInteractionText] = useState("");
  const query = useQuery({ queryKey: ["sponsors"], enabled: canManage, queryFn: async () => {
    const { data, error } = await supabase.from("sponsors").select("*").order("updated_at", { ascending: false });
    if (error) throw error; return data as Sponsor[];
  }});
  const interactions = useQuery({ queryKey: ["sponsor-interactions", selected], enabled: canManage && Boolean(selected), queryFn: async () => {
    const { data, error } = await supabase.from("sponsor_interactions").select("*").eq("sponsor_id", selected!).order("happened_at", { ascending: false }).limit(30);
    if (error) throw error; return data as Interaction[];
  }});
  const save = useMutation({ mutationFn: async () => {
    if (!draft || !access) return;
    const payload = { ...draft, pledged_cash: Number(draft.pledged_cash), received_cash: Number(draft.received_cash), estimated_in_kind_value: Number(draft.estimated_in_kind_value) };
    const result = draft.id
      ? await supabase.from("sponsors").update(payload).eq("id", draft.id)
      : await supabase.from("sponsors").insert({ ...payload, created_by: access.userId });
    if (result.error) throw result.error;
  }, onSuccess: () => { void cache.invalidateQueries({ queryKey: ["sponsors"] }); setDraft(null); }});
  const addInteraction = useMutation({ mutationFn: async () => {
    if (!selected || !access) return;
    const { error } = await supabase.from("sponsor_interactions").insert({ sponsor_id: selected, interaction_type: interactionType, summary: interactionText.trim(), actor_user_id: access.userId, actor_name: access.displayName });
    if (error) throw error;
  }, onSuccess: () => { setInteractionText(""); void cache.invalidateQueries({ queryKey: ["sponsor-interactions", selected] }); }});
  const archive = useMutation({ mutationFn: async (row: Sponsor) => {
    const { error } = await supabase.from("sponsors").update({ archived_at: row.archived_at ? null : new Date().toISOString() }).eq("id", row.id);
    if (error) throw error;
  }, onSuccess: () => void cache.invalidateQueries({ queryKey: ["sponsors"] }) });

  const rows = (query.data ?? []).filter((r) => {
    const phrase = `${r.organization_name} ${r.contact_name} ${r.email} ${r.owner_name}`.toLocaleLowerCase("it");
    return !r.archived_at && phrase.includes(search.trim().toLocaleLowerCase("it")) && (stage === "all" || stage === r.status);
  });
  const active = rows.filter((r) => r.status === "active").length;
  const pledged = rows.reduce((sum, r) => sum + Number(r.pledged_cash), 0);
  const due = rows.filter((r) => r.next_follow_up && r.next_follow_up <= new Date().toISOString().slice(0,10)).length;
  const error = query.error ?? interactions.error ?? save.error ?? addInteraction.error ?? archive.error;

  if (!canManage) return <div className="page-container"><PageHeader title="Sponsor" eyebrow="Accesso riservato" description="Questa sezione è disponibile a Logistica, Capo Logistica e Team Leader." /></div>;

  return <div className="page-container sponsor-page">
    <PageHeader title="Sponsor" eyebrow="Logistica · Capo Logistica · Team Leader" description="Tieni insieme contatti, proposte, contributi e prossime azioni. Ogni passaggio resta nello storico." />
    {error && <p className="form-error" role="alert">{error instanceof Error ? error.message : "Operazione non riuscita."}</p>}
    <div className="sponsor-stats">
      <article className="sponsor-stat"><span>Contatti attivi</span><strong>{active}</strong></article>
      <article className="sponsor-stat"><span>Contributi promessi</span><strong>{euro.format(pledged)}</strong></article>
      <article className={due ? "sponsor-stat sponsor-stat--due" : "sponsor-stat"}><span>Follow-up da fare</span><strong>{due}</strong></article>
    </div>
    <section className="panel panel__body sponsor-section">
      <header className="sponsor-toolbar"><div><h2><Building2 size={19}/> Pipeline sponsor</h2><p>Una scheda per ogni azienda o realtà contattata.</p></div><div className="sponsor-toolbar__actions"><button className="button button--secondary" type="button" onClick={() => exportSponsors(query.data ?? [])}>Esporta CSV</button><button className="button button--primary" type="button" onClick={() => setDraft({ ...blank })}><CirclePlus size={16}/> Nuovo contatto</button></div></header>
      <div className="sponsor-filters"><label className="sponsor-search"><Search size={16}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cerca azienda, contatto o responsabile" aria-label="Cerca sponsor"/></label><select className="input" value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Filtra per fase"><option value="all">Tutte le fasi</option>{Object.entries(stages).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select><span>{rows.length} {rows.length === 1 ? "scheda" : "schede"}</span></div>
      {query.isLoading ? <p>Caricamento sponsor…</p> : rows.length === 0 ? <div className="sponsor-empty"><UsersRound size={24}/><strong>Nessun contatto ancora</strong><span>Aggiungi la prima realtà da contattare per costruire la pipeline.</span></div> : <div className="sponsor-list">{rows.map((row) => <article className="sponsor-card" key={row.id}>
        <div className="sponsor-card__main"><div className="sponsor-card__title"><h3>{row.organization_name}</h3><span className={`sponsor-stage sponsor-stage--${row.status}`}>{stages[row.status]}</span></div><p>{row.contact_name || "Referente da inserire"}{row.owner_name ? ` · Responsabile: ${row.owner_name}` : ""}</p><div className="sponsor-card__links">{row.email && <a href={`mailto:${row.email}`}><Mail size={14}/>{row.email}</a>}{row.phone && <a href={`tel:${row.phone}`}><Phone size={14}/>{row.phone}</a>}</div>{row.in_kind_description && <p className="sponsor-card__kind">Materiali/servizi: {row.in_kind_description}</p>}</div>
        <div className="sponsor-card__value"><strong>{euro.format(Number(row.pledged_cash))}</strong><span>promessi · {euro.format(Number(row.received_cash))} ricevuti</span>{row.next_follow_up && <small><CalendarClock size={13}/> Contatto: {new Date(`${row.next_follow_up}T12:00:00`).toLocaleDateString("it-IT")}</small>}{row.renewal_date && <small>Rinnovo: {new Date(`${row.renewal_date}T12:00:00`).toLocaleDateString("it-IT")}</small>}</div>
        <div className="sponsor-card__actions"><button className="button button--secondary button--small" type="button" onClick={() => setSelected(selected === row.id ? null : row.id)}><History size={15}/> {selected === row.id ? "Chiudi storico" : "Storico"}</button><button className="button button--secondary button--small" type="button" onClick={() => setDraft({ ...row })}>Modifica</button><button className="button button--secondary button--small" type="button" onClick={() => archive.mutate(row)}><Archive size={15}/> Archivia</button></div>
        {selected === row.id && <div className="sponsor-history"><h4>Attività · {row.organization_name}</h4><form className="sponsor-interaction" onSubmit={(e) => {e.preventDefault(); addInteraction.mutate();}}><select className="input" value={interactionType} onChange={(e) => setInteractionType(e.target.value)}><option value="email">Email</option><option value="call">Telefonata</option><option value="meeting">Incontro</option><option value="other">Altro</option></select><input className="input" value={interactionText} onChange={(e) => setInteractionText(e.target.value)} placeholder="Aggiungi una nota sul contatto" required minLength={2}/><button className="button button--primary button--small" disabled={addInteraction.isPending}>Registra</button></form>{interactions.data?.length ? <ol className="sponsor-timeline">{interactions.data.map((item) => <li key={item.id}><span>{item.interaction_type === "email" ? "Email" : item.interaction_type === "call" ? "Telefonata" : item.interaction_type === "meeting" ? "Incontro" : "Nota"}</span><p>{item.summary}</p><small>{item.actor_name} · {new Date(item.happened_at).toLocaleString("it-IT")}</small></li>)}</ol> : <p>Nessuna attività registrata.</p>}</div>}
      </article>)}</div>}
    </section>
    {draft && <div className="sponsor-modal-backdrop" role="presentation" onMouseDown={(e) => {if (e.target === e.currentTarget) setDraft(null);}}><section className="panel sponsor-modal" role="dialog" aria-modal="true" aria-labelledby="sponsor-editor-title"><header><div><p className="eyebrow">Scheda sponsor</p><h2 id="sponsor-editor-title">{draft.id ? "Modifica contatto" : "Nuovo contatto"}</h2></div><button className="icon-button" type="button" aria-label="Chiudi" onClick={() => setDraft(null)}><X size={18}/></button></header><form className="sponsor-form" onSubmit={(e) => {e.preventDefault(); save.mutate();}}>
      <label className="form-field sponsor-form__wide">Organizzazione *<input className="input" required minLength={2} maxLength={180} value={draft.organization_name} onChange={(e) => setDraft({...draft,organization_name:e.target.value})}/></label>
      <label className="form-field">Referente<input className="input" maxLength={160} value={draft.contact_name} onChange={(e) => setDraft({...draft,contact_name:e.target.value})}/></label><label className="form-field">Responsabile<input className="input" maxLength={160} value={draft.owner_name} onChange={(e) => setDraft({...draft,owner_name:e.target.value})} placeholder={access?.displayName}/></label>
      <label className="form-field">Email<input className="input" type="email" maxLength={254} value={draft.email} onChange={(e) => setDraft({...draft,email:e.target.value})}/></label><label className="form-field">Telefono<input className="input" type="tel" maxLength={60} value={draft.phone} onChange={(e) => setDraft({...draft,phone:e.target.value})}/></label>
      <label className="form-field">Fase<select className="input" value={draft.status} onChange={(e) => setDraft({...draft,status:e.target.value as Sponsor["status"]})}>{Object.entries(stages).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="form-field">Tipo contributo<select className="input" value={draft.contribution_type} onChange={(e) => setDraft({...draft,contribution_type:e.target.value as Sponsor["contribution_type"]})}><option value="cash">Denaro</option><option value="in_kind">Materiali/servizi</option><option value="mixed">Denaro e materiali</option></select></label>
      <label className="form-field">Contributo promesso (€)<input className="input" type="number" min="0" step="0.01" value={draft.pledged_cash} onChange={(e) => setDraft({...draft,pledged_cash:Number(e.target.value)})}/></label><label className="form-field">Denaro ricevuto (€)<input className="input" type="number" min="0" step="0.01" value={draft.received_cash} onChange={(e) => setDraft({...draft,received_cash:Number(e.target.value)})}/></label>
      <label className="form-field sponsor-form__wide">Materiali o servizi offerti<textarea className="input" rows={2} maxLength={3000} value={draft.in_kind_description} onChange={(e) => setDraft({...draft,in_kind_description:e.target.value})}/></label><label className="form-field">Valore stimato (€)<input className="input" type="number" min="0" step="0.01" value={draft.estimated_in_kind_value} onChange={(e) => setDraft({...draft,estimated_in_kind_value:Number(e.target.value)})}/></label>
      <label className="form-field">Prossimo contatto<input className="input" type="date" value={draft.next_follow_up ?? ""} onChange={(e) => setDraft({...draft,next_follow_up:e.target.value || null})}/></label><label className="form-field">Scadenza rinnovo<input className="input" type="date" value={draft.renewal_date ?? ""} onChange={(e) => setDraft({...draft,renewal_date:e.target.value || null})}/></label>
      <label className="form-field sponsor-form__wide">Note<textarea className="input" rows={3} maxLength={5000} value={draft.notes} onChange={(e) => setDraft({...draft,notes:e.target.value})}/></label>
      {save.error && <p className="form-error sponsor-form__wide" role="alert">{save.error.message}</p>}<footer className="sponsor-form__actions"><button className="button button--secondary" type="button" onClick={() => setDraft(null)}>Annulla</button><button className="button button--primary" disabled={save.isPending}><Save size={16}/>{save.isPending ? "Salvataggio…" : "Salva scheda"}</button></footer>
    </form></section></div>}
  </div>;
}

