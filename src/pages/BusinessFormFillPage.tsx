import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { useParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { businessFormErrorMessage, hasOptions, type FormQuestion } from "../lib/business-forms";
import { supabase } from "../lib/supabase";

interface FormForResponse {
  id: string; title: string; description: string; is_open: boolean; can_answer: boolean; questions: FormQuestion[];
}
type Answers = Record<string, unknown>;

/** Compilazione del form tramite link: solo i Capi Area possono rispondere. Chi gestisce vede un'anteprima. */
export function BusinessFormFillPage() {
  const { token = "" } = useParams();
  const [answers, setAnswers] = useState<Answers>({});
  const [sent, setSent] = useState(false);

  const form = useQuery({
    queryKey: ["business-form-fill", token], retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("business_form_for_response", { p_token: token });
      if (error) throw error;
      return data as FormForResponse;
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      const payload: Answers = {};
      for (const [id, value] of Object.entries(answers)) payload[id] = value;
      const { error } = await supabase.rpc("submit_business_form", { p_token: token, p_answers: payload });
      if (error) throw error;
    },
    onSuccess: () => { setSent(true); setAnswers({}); },
  });

  const set = (id: string, value: unknown) => setAnswers((current) => ({ ...current, [id]: value }));

  if (form.isLoading) return <div className="page-container"><p>Caricamento…</p></div>;
  if (form.error || !form.data) {
    return (
      <div className="page-container">
        <PageHeader title="Form" eyebrow="Team Galileo Pisa" description="Questo form non è disponibile." />
        <p className="form-error" role="alert">{businessFormErrorMessage(form.error)}</p>
      </div>
    );
  }

  const data = form.data;
  const canSubmit = data.can_answer && data.is_open;

  if (sent) {
    return (
      <div className="page-container bf-fill">
        <section className="panel panel__body bf-done">
          <CheckCircle2 size={36} />
          <h2>Risposta inviata</h2>
          <p>Grazie! Le tue risposte sono state registrate con il tuo account.</p>
          {data.is_open && <button className="button button--secondary" type="button" onClick={() => setSent(false)}>Invia un'altra risposta</button>}
        </section>
      </div>
    );
  }

  return (
    <div className="page-container bf-fill">
      <PageHeader title={data.title} eyebrow="Form per i Capi Area" description={data.description || undefined} />
      {!data.can_answer && <p className="bf-banner">Anteprima: solo i Capi Area possono compilare questo form.</p>}
      {data.can_answer && !data.is_open && <p className="bf-banner">Questo form è chiuso: non accetta più risposte.</p>}
      {submit.error && <p className="form-error" role="alert">{businessFormErrorMessage(submit.error)}</p>}

      <form className="panel panel__body bf-fill__form" onSubmit={(e: FormEvent) => { e.preventDefault(); if (canSubmit) submit.mutate(); }}>
        {data.questions.length === 0 && <p>Questo form non ha ancora domande.</p>}
        {data.questions.map((q) => {
          const value = answers[q.id];
          const label = <span className="bf-fill__label">{q.label}{q.required && <span className="bf-required"> *</span>}</span>;
          return (
            <fieldset key={q.id} className="bf-fill__question" disabled={!canSubmit}>
              <legend>{label}</legend>
              {q.help && <p className="bf-hint">{q.help}</p>}
              {q.kind === "short_text" && <input className="input" maxLength={300} value={String(value ?? "")} onChange={(e) => set(q.id, e.target.value)} />}
              {q.kind === "long_text" && <textarea className="input" rows={4} maxLength={4000} value={String(value ?? "")} onChange={(e) => set(q.id, e.target.value)} />}
              {q.kind === "number" && <input className="input" type="number" step="any" value={value === undefined ? "" : String(value)} onChange={(e) => set(q.id, e.target.value === "" ? undefined : Number(e.target.value))} />}
              {q.kind === "date" && <input className="input" type="date" value={String(value ?? "")} onChange={(e) => set(q.id, e.target.value)} />}
              {q.kind === "single_choice" && (
                <div className="bf-fill__options">
                  {q.options.map((option) => <label key={option} className="bf-check"><input type="radio" name={q.id} checked={value === option} onChange={() => set(q.id, option)} /> {option}</label>)}
                </div>
              )}
              {q.kind === "multiple_choice" && hasOptions(q.kind) && (
                <div className="bf-fill__options">
                  {q.options.map((option) => {
                    const picked = Array.isArray(value) ? (value as string[]) : [];
                    return <label key={option} className="bf-check"><input type="checkbox" checked={picked.includes(option)}
                      onChange={(e) => set(q.id, e.target.checked ? [...picked, option] : picked.filter((item) => item !== option))} /> {option}</label>;
                  })}
                </div>
              )}
              {q.kind === "yes_no" && (
                <div className="bf-fill__options">
                  <label className="bf-check"><input type="radio" name={q.id} checked={value === true} onChange={() => set(q.id, true)} /> Sì</label>
                  <label className="bf-check"><input type="radio" name={q.id} checked={value === false} onChange={() => set(q.id, false)} /> No</label>
                </div>
              )}
              {q.kind === "rating" && (
                <div className="bf-fill__options bf-fill__options--row">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <label key={n} className={`bf-star${value === n ? " bf-star--on" : ""}`}><input type="radio" name={q.id} checked={value === n} onChange={() => set(q.id, n)} />{n}</label>
                  ))}
                </div>
              )}
            </fieldset>
          );
        })}
        {canSubmit && data.questions.length > 0 && <button className="button button--primary" disabled={submit.isPending}>{submit.isPending ? "Invio…" : "Invia risposte"}</button>}
      </form>
    </div>
  );
}
