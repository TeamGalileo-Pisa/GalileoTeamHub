import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, Download, Link2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../hooks/useAuth";
import {
  businessFormErrorMessage, formatAnswer, hasOptions, isEmptyAnswer, KIND_LABELS, publicFormLink, questionsWithAnswers, summarizeQuestion,
  type BusinessForm, type FormQuestion, type FormResponse, type QuestionKind,
} from "../lib/business-forms";
import { downloadBusinessFormExport } from "../lib/business-forms-export";
import { supabase } from "../lib/supabase";

type Tab = "summary" | "responses" | "pending" | "questions";
type QuestionDraft = { id?: string; label: string; help: string; kind: QuestionKind; options: string; required: boolean };
const blankQuestion: QuestionDraft = { label: "", help: "", kind: "short_text", options: "", required: false };
const stamp = (iso: string) => new Date(iso).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Rome" });

export function BusinessFormsPage() {
  const { access } = useAuth();
  const cache = useQueryClient();
  const canManage = Boolean(access && (access.isAdmin || access.areas.some((area) => area.slug === "business")));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("summary");
  const [newTitle, setNewTitle] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [draft, setDraft] = useState<QuestionDraft | null>(null);
  const [search, setSearch] = useState("");

  const forms = useQuery({
    queryKey: ["business-forms"], enabled: canManage,
    queryFn: async () => {
      const { data, error } = await supabase.from("business_forms").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as BusinessForm[];
    },
  });
  const counts = useQuery({
    queryKey: ["business-form-counts"], enabled: canManage,
    queryFn: async () => {
      const { data, error } = await supabase.from("business_form_responses").select("form_id,created_at");
      if (error) throw error;
      const byForm = new Map<string, { count: number; last: string }>();
      for (const row of data as { form_id: string; created_at: string }[]) {
        const current = byForm.get(row.form_id) ?? { count: 0, last: "" };
        byForm.set(row.form_id, { count: current.count + 1, last: row.created_at > current.last ? row.created_at : current.last });
      }
      return byForm;
    },
  });

  const form = forms.data?.find((item) => item.id === selectedId) ?? null;

  const questions = useQuery({
    queryKey: ["business-form-questions", selectedId], enabled: Boolean(selectedId),
    queryFn: async () => {
      const { data, error } = await supabase.from("business_form_questions").select("*").eq("form_id", selectedId!).order("position").order("created_at");
      if (error) throw error;
      return (data ?? []).map((row) => ({ ...row, options: Array.isArray(row.options) ? row.options.map(String) : [] })) as FormQuestion[];
    },
  });
  const responses = useQuery({
    queryKey: ["business-form-responses", selectedId], enabled: Boolean(selectedId),
    queryFn: async () => {
      const { data, error } = await supabase.from("business_form_responses").select("*").eq("form_id", selectedId!).order("created_at", { ascending: false });
      if (error) throw error;
      return data as FormResponse[];
    },
  });
  const pending = useQuery({
    queryKey: ["business-form-pending", selectedId], enabled: Boolean(selectedId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("business_form_pending_leads", { p_form: selectedId });
      if (error) throw error;
      return (data ?? []) as { user_id: string; name: string; area_names: string }[];
    },
  });

  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ["business-forms"] });
    void cache.invalidateQueries({ queryKey: ["business-form-counts"] });
    void cache.invalidateQueries({ queryKey: ["business-form-questions"] });
    void cache.invalidateQueries({ queryKey: ["business-form-responses"] });
    void cache.invalidateQueries({ queryKey: ["business-form-pending"] });
  };

  const createForm = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from("business_forms").insert({ title: newTitle.trim(), created_by: access?.userId }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => { setNewTitle(""); setSelectedId(id); setTab("questions"); refresh(); },
  });
  const updateForm = useMutation({
    mutationFn: async (patch: Partial<Pick<BusinessForm, "title" | "description" | "is_open">>) => {
      const { error } = await supabase.from("business_forms").update(patch).eq("id", selectedId!);
      if (error) throw error;
    },
    onSuccess: refresh,
  });
  const deleteForm = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("business_forms").delete().eq("id", selectedId!);
      if (error) throw error;
    },
    onSuccess: () => { setSelectedId(null); refresh(); },
  });
  const saveQuestion = useMutation({
    mutationFn: async (value: QuestionDraft) => {
      const options = hasOptions(value.kind) ? [...new Set(value.options.split("\n").map((line) => line.trim()).filter(Boolean))] : [];
      if (hasOptions(value.kind) && options.length < 2) throw new Error("Inserisci almeno due opzioni, una per riga.");
      const payload = { label: value.label.trim(), help: value.help.trim(), kind: value.kind, options, required: value.required };
      if (value.id) {
        const { error } = await supabase.from("business_form_questions").update(payload).eq("id", value.id);
        if (error) throw error;
      } else {
        const next = (questions.data ?? []).reduce((max, q) => Math.max(max, q.position ?? 0), -1) + 1;
        const { error } = await supabase.from("business_form_questions").insert({ ...payload, form_id: selectedId, position: next });
        if (error) throw error;
      }
    },
    onSuccess: () => { setDraft(null); refresh(); },
  });
  const archiveQuestion = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("business_form_questions").update({ archived_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
  });
  const reorder = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.rpc("reorder_business_form_questions", { p_form: selectedId, p_ids: ids });
      if (error) throw error;
    },
    onSuccess: refresh,
  });
  const deleteResponse = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("business_form_responses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
  });
  const exportExcel = useMutation({ mutationFn: () => downloadBusinessFormExport(selectedId!) });

  const activeQuestions = useMemo(() => (questions.data ?? []).filter((q) => !q.archived_at), [questions.data]);
  const summaryQuestions = useMemo(() => questionsWithAnswers(questions.data ?? [], responses.data ?? []), [questions.data, responses.data]);
  const visibleResponses = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("it");
    return (responses.data ?? []).filter((r) => !needle || `${r.respondent_name} ${r.area_names}`.toLocaleLowerCase("it").includes(needle));
  }, [responses.data, search]);
  const respondents = new Set((responses.data ?? []).map((r) => r.respondent_id ?? r.respondent_name)).size;
  const leadTotal = respondents + (pending.data?.length ?? 0);

  const copyLink = async (token: string) => {
    const url = publicFormLink(token);
    try { await navigator.clipboard.writeText(url); } catch { window.prompt("Copia il link del form:", url); return; }
    setCopied(token);
    window.setTimeout(() => setCopied(null), 2500);
  };
  const move = (id: string, delta: number) => {
    const ids = activeQuestions.map((q) => q.id);
    const index = ids.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder.mutate(ids);
  };

  const error = forms.error ?? counts.error ?? questions.error ?? responses.error ?? pending.error ?? createForm.error ?? updateForm.error
    ?? deleteForm.error ?? saveQuestion.error ?? archiveQuestion.error ?? reorder.error ?? deleteResponse.error ?? exportExcel.error;

  if (!canManage) {
    return <div className="page-container"><PageHeader title="Form Business" eyebrow="Accesso riservato" description="Questa sezione è disponibile a Team Leader e Business." /></div>;
  }

  return (
    <div className="page-container bf-page">
      <PageHeader title="Form Business" eyebrow="Team Leader · Business" description="Crea un form, condividi il link con i Capi Area e leggi le risposte raccolte nel tempo." />
      {error && <p className="form-error" role="alert">{businessFormErrorMessage(error)}</p>}

      <section className="panel panel__body bf-new">
        <form className="bf-new__form" onSubmit={(e: FormEvent) => { e.preventDefault(); if (newTitle.trim().length >= 2) createForm.mutate(); }}>
          <label className="form-field">Nuovo form
            <input className="input" required minLength={2} maxLength={160} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Es. Check-in mensile delle aree" />
          </label>
          <button className="button button--primary" disabled={createForm.isPending}><Plus size={16} /> Crea form</button>
        </form>
      </section>

      {forms.isLoading ? <p>Caricamento…</p> : (forms.data ?? []).length === 0 ? (
        <section className="panel panel__body"><p>Non c'è ancora nessun form. Creane uno qui sopra: poi aggiungi le domande e condividi il link con i Capi Area.</p></section>
      ) : (
        <div className="bf-list">
          {(forms.data ?? []).map((item) => {
            const stats = counts.data?.get(item.id);
            return (
              <article key={item.id} className={`panel bf-card${item.id === selectedId ? " bf-card--active" : ""}`}>
                <button type="button" className="bf-card__main" onClick={() => { setSelectedId(item.id); setTab("summary"); setDraft(null); }}>
                  <strong>{item.title}</strong>
                  <span className={`bf-badge ${item.is_open ? "bf-badge--open" : "bf-badge--closed"}`}>{item.is_open ? "Aperto" : "Chiuso"}</span>
                  <small>{stats ? `${stats.count} ${stats.count === 1 ? "risposta" : "risposte"} · ultima ${stamp(stats.last)}` : "Nessuna risposta"}</small>
                </button>
              </article>
            );
          })}
        </div>
      )}

      {form && (
        <section className="panel panel__body bf-detail">
          <header className="bf-detail__head">
            <div>
              <h2>{form.title}</h2>
              {form.description && <p>{form.description}</p>}
            </div>
            <div className="bf-detail__actions">
              <button className="button button--secondary button--small" type="button" onClick={() => void copyLink(form.share_token)} title="Il link si apre solo con l'account di un Capo Area">
                {copied === form.share_token ? <><Check size={14} /> Link copiato</> : <><Link2 size={14} /> Copia link per i Capi Area</>}
              </button>
              <button className="button button--secondary button--small" type="button" disabled={exportExcel.isPending} onClick={() => exportExcel.mutate()}>
                <Download size={14} /> {exportExcel.isPending ? "Preparo l'Excel…" : "Scarica Excel"}
              </button>
              <button className={`button button--small ${form.is_open ? "button--secondary" : "button--primary"}`} type="button" disabled={updateForm.isPending}
                onClick={() => updateForm.mutate({ is_open: !form.is_open })}>
                {form.is_open ? "Chiudi le risposte" : "Apri le risposte"}
              </button>
              <button className="button button--danger button--small" type="button" disabled={deleteForm.isPending}
                onClick={() => { if (window.confirm(`Eliminare definitivamente il form "${form.title}" e tutte le sue risposte? L'operazione non si può annullare.`)) deleteForm.mutate(); }}>
                <Trash2 size={14} /> Elimina
              </button>
            </div>
          </header>
          <p className="bf-hint">Il link si apre solo con l'account di un Capo Area. {form.is_open ? "Le risposte sono aperte." : "Il form è chiuso: nessuno può rispondere finché non lo riapri."}</p>

          <nav className="bf-tabs" role="tablist" aria-label="Sezioni del form">
            {([["summary", "Riepilogo"], ["responses", `Risposte (${responses.data?.length ?? 0})`], ["pending", `Chi manca (${pending.data?.length ?? 0})`], ["questions", `Domande (${activeQuestions.length})`]] as [Tab, string][]).map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} className={`bf-tab${tab === key ? " bf-tab--active" : ""}`} onClick={() => setTab(key)}>{label}</button>
            ))}
          </nav>

          {tab === "questions" && (
            <div className="bf-questions">
              <details className="bf-settings">
                <summary>Titolo e descrizione del form</summary>
                <form key={form.updated_at} className="bf-settings__form" onSubmit={(e: FormEvent<HTMLFormElement>) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  updateForm.mutate({ title: String(data.get("title") ?? "").trim(), description: String(data.get("description") ?? "").trim() });
                }}>
                  <label className="form-field">Titolo<input className="input" name="title" required minLength={2} maxLength={160} defaultValue={form.title} /></label>
                  <label className="form-field">Descrizione per chi compila<textarea className="input" name="description" rows={3} maxLength={2000} defaultValue={form.description} /></label>
                  <button className="button button--primary button--small" disabled={updateForm.isPending}>Salva</button>
                </form>
              </details>

              {activeQuestions.length === 0 && <p>Nessuna domanda: aggiungine una qui sotto.</p>}
              <ol className="bf-question-list">
                {activeQuestions.map((q, index) => (
                  <li key={q.id} className="bf-question">
                    <div className="bf-question__body">
                      <strong>{q.label}{q.required && <span className="bf-required" title="Obbligatoria"> *</span>}</strong>
                      <span className="bf-kind">{KIND_LABELS[q.kind]}</span>
                      {q.help && <small>{q.help}</small>}
                      {hasOptions(q.kind) && <small>Opzioni: {q.options.join(" · ")}</small>}
                    </div>
                    <div className="bf-question__actions">
                      <button type="button" className="icon-button" aria-label="Sposta su" disabled={index === 0 || reorder.isPending} onClick={() => move(q.id, -1)}><ArrowUp size={16} /></button>
                      <button type="button" className="icon-button" aria-label="Sposta giù" disabled={index === activeQuestions.length - 1 || reorder.isPending} onClick={() => move(q.id, 1)}><ArrowDown size={16} /></button>
                      <button type="button" className="icon-button" aria-label="Modifica domanda" onClick={() => setDraft({ id: q.id, label: q.label, help: q.help, kind: q.kind, options: q.options.join("\n"), required: q.required })}><Pencil size={16} /></button>
                      <button type="button" className="icon-button" aria-label="Elimina domanda" onClick={() => { if (window.confirm("Eliminare questa domanda? Le risposte già raccolte restano nell'Excel e nel riepilogo.")) archiveQuestion.mutate(q.id); }}><Trash2 size={16} /></button>
                    </div>
                  </li>
                ))}
              </ol>

              {draft ? (
                <form className="bf-editor" onSubmit={(e: FormEvent) => { e.preventDefault(); saveQuestion.mutate(draft); }}>
                  <h3>{draft.id ? "Modifica domanda" : "Nuova domanda"}</h3>
                  <label className="form-field">Domanda *<input className="input" required minLength={2} maxLength={300} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></label>
                  <label className="form-field">Spiegazione (facoltativa)<input className="input" maxLength={500} value={draft.help} onChange={(e) => setDraft({ ...draft, help: e.target.value })} /></label>
                  <label className="form-field">Tipo di risposta
                    <select className="input" value={draft.kind} disabled={Boolean(draft.id) && (responses.data?.length ?? 0) > 0} onChange={(e) => setDraft({ ...draft, kind: e.target.value as QuestionKind })}>
                      {(Object.keys(KIND_LABELS) as QuestionKind[]).map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
                    </select>
                  </label>
                  {draft.id && (responses.data?.length ?? 0) > 0 && <p className="bf-hint">Il tipo non si cambia dopo che sono arrivate risposte: crea una nuova domanda.</p>}
                  {hasOptions(draft.kind) && (
                    <label className="form-field">Opzioni (una per riga) *<textarea className="input" rows={4} value={draft.options} onChange={(e) => setDraft({ ...draft, options: e.target.value })} placeholder={"In linea\nIn ritardo"} /></label>
                  )}
                  <label className="bf-check"><input type="checkbox" checked={draft.required} onChange={(e) => setDraft({ ...draft, required: e.target.checked })} /> Risposta obbligatoria</label>
                  <div className="bf-editor__actions">
                    <button className="button button--primary" disabled={saveQuestion.isPending}>{saveQuestion.isPending ? "Salvataggio…" : "Salva domanda"}</button>
                    <button className="button button--secondary" type="button" onClick={() => setDraft(null)}>Annulla</button>
                  </div>
                </form>
              ) : (
                <button className="button button--primary" type="button" onClick={() => setDraft({ ...blankQuestion })}><Plus size={16} /> Aggiungi domanda</button>
              )}
            </div>
          )}

          {tab === "summary" && (
            <div className="bf-summary">
              <div className="bf-stats">
                <div className="bf-stat"><strong>{responses.data?.length ?? 0}</strong><span>risposte ricevute</span></div>
                <div className="bf-stat"><strong>{respondents}</strong><span>Capi Area hanno risposto</span></div>
                <div className="bf-stat"><strong>{pending.data?.length ?? 0}</strong><span>non hanno ancora risposto{leadTotal ? ` (su ${leadTotal})` : ""}</span></div>
              </div>
              {(responses.data?.length ?? 0) === 0 ? <p>Ancora nessuna risposta: condividi il link con i Capi Area.</p> : summaryQuestions.map((q) => {
                const summary = summarizeQuestion(q, responses.data ?? []);
                return (
                  <article key={q.id} className="bf-summary-card">
                    <h3>{q.label}{q.archived_at && <small> (domanda eliminata)</small>}</h3>
                    <p className="bf-hint">{summary.answered} {summary.answered === 1 ? "risposta" : "risposte"}</p>
                    {summary.kind === "choice" && (
                      <ul className="bf-bars">
                        {summary.counts.map((row) => (
                          <li key={row.option}><span className="bf-bars__label">{row.option}</span>
                            <span className="bf-bars__track"><span className="bf-bars__fill" style={{ width: `${row.percent}%` }} /></span>
                            <span className="bf-bars__value">{row.count} · {row.percent}%</span></li>
                        ))}
                      </ul>
                    )}
                    {summary.kind === "number" && (
                      <>
                        <p className="bf-number"><strong>{summary.average}</strong> media · min {summary.min} · max {summary.max}</p>
                        {summary.counts && (
                          <ul className="bf-bars">
                            {summary.counts.map((row) => (
                              <li key={row.option}><span className="bf-bars__label">{row.option} ★</span>
                                <span className="bf-bars__track"><span className="bf-bars__fill" style={{ width: `${row.percent}%` }} /></span>
                                <span className="bf-bars__value">{row.count}</span></li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                    {summary.kind === "text" && (
                      <ul className="bf-quotes">
                        {summary.entries.slice(0, 5).map((entry, i) => <li key={i}><q>{entry.text}</q><small>{entry.name} · {stamp(entry.at)}</small></li>)}
                        {summary.entries.length > 5 && <li><small>… e altre {summary.entries.length - 5} nella scheda “Risposte” e nell'Excel.</small></li>}
                      </ul>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          {tab === "responses" && (
            <div className="bf-responses">
              <label className="application-search"><span>Cerca per account o area</span>
                <span className="application-search__input"><Search size={17} aria-hidden="true" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome o area" /></span>
              </label>
              {visibleResponses.length === 0 && <p>Nessuna risposta da mostrare.</p>}
              {visibleResponses.map((response) => (
                <details key={response.id} className="bf-response">
                  <summary><strong>{response.respondent_name}</strong> <span>{response.area_names ? `Capo ${response.area_names}` : ""} · {stamp(response.created_at)}</span></summary>
                  <dl className="bf-answers">
                    {summaryQuestions.map((q) => {
                      const value = response.answers?.[q.id];
                      if (isEmptyAnswer(value)) return null;
                      return <div key={q.id}><dt>{q.label}</dt><dd>{formatAnswer(q, value)}</dd></div>;
                    })}
                  </dl>
                  <button className="button button--danger button--small" type="button" disabled={deleteResponse.isPending}
                    onClick={() => { if (window.confirm(`Eliminare la risposta di ${response.respondent_name}?`)) deleteResponse.mutate(response.id); }}>
                    <Trash2 size={14} /> Elimina risposta
                  </button>
                </details>
              ))}
            </div>
          )}

          {tab === "pending" && (
            <div className="bf-pending">
              {pending.isLoading ? <p>Caricamento…</p> : (pending.data ?? []).length === 0 ? <p>Tutti i Capi Area hanno risposto almeno una volta.</p> : (
                <>
                  <p className="bf-hint">Capi Area che non hanno ancora compilato questo form.</p>
                  <ul className="bf-pending__list">
                    {(pending.data ?? []).map((lead) => <li key={lead.user_id}><strong>{lead.name}</strong><span>{lead.area_names}</span></li>)}
                  </ul>
                </>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
