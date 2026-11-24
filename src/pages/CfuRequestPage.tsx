import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Brand } from "../components/Brand";
import { cfuErrorMessage } from "../lib/cfu";
import { supabase } from "../lib/supabase";

interface PublicInfo { open: boolean; areas: { id: string; name: string }[] }

// Link pubblico: il membro inserisce i propri dati per la richiesta di riconoscimento CFU.
export function CfuRequestPage() {
  const [form, setForm] = useState({
    first_name: "", last_name: "", student_number: "", degree: "", professor_name: "", professor_email: "",
  });
  const [error, setError] = useState("");
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const info = useQuery({
    queryKey: ["cfu-public-info"],
    queryFn: async () => {
      const { data, error: rpcError } = await supabase.rpc("cfu_public_info");
      if (rpcError) throw rpcError;
      return data as PublicInfo;
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      const { error: rpcError } = await supabase.rpc("cfu_submit_request", { p_data: form });
      if (rpcError) throw rpcError;
    },
    onError: (e) => setError(cfuErrorMessage(e)),
  });

  const onSubmit = (event: FormEvent) => { event.preventDefault(); setError(""); submit.mutate(); };

  return (
    <main className="page-container" style={{ maxWidth: 720, margin: "auto", padding: 24 }}>
      <Brand />
      <h1>Team Galileo Pisa · Richiesta di riconoscimento CFU</h1>
      {info.isPending ? <p>Caricamento…</p> : info.error ? <p className="form-error" role="alert">{cfuErrorMessage(info.error)}</p>
        : !info.data.open ? <p>Le richieste di riconoscimento CFU non sono al momento aperte.</p>
        : submit.isSuccess ? <p role="status"><strong>Richiesta inviata.</strong> Il Team Leader riceverà i tuoi dati.</p>
        : (
          <form className="form-grid" onSubmit={onSubmit}>
            <p style={{ gridColumn: "1 / -1" }}>Inserisci i tuoi dati per la richiesta di riconoscimento dei CFU per l'attività svolta nel Team.</p>
            <label className="form-field">Nome<input className="input" required maxLength={120} value={form.first_name} onChange={(e) => set("first_name", e.target.value)} /></label>
            <label className="form-field">Cognome<input className="input" required maxLength={120} value={form.last_name} onChange={(e) => set("last_name", e.target.value)} /></label>
            <label className="form-field">Matricola<input className="input" required maxLength={40} value={form.student_number} onChange={(e) => set("student_number", e.target.value)} /></label>
            <label className="form-field">Corso di Studi (nome completo)<input className="input" required maxLength={200} value={form.degree} onChange={(e) => set("degree", e.target.value)} /></label>
            <label className="form-field">Docente del Corso di Laurea<input className="input" required maxLength={200} value={form.professor_name} onChange={(e) => set("professor_name", e.target.value)} /></label>
            <label className="form-field">Mail del docente del Corso di Laurea<input className="input" type="email" required maxLength={200} value={form.professor_email} onChange={(e) => set("professor_email", e.target.value)} /></label>
            {error && <p className="form-error" role="alert" style={{ gridColumn: "1 / -1" }}>{error}</p>}
            <div className="form-actions" style={{ gridColumn: "1 / -1" }}><button className="button button--primary" type="submit" disabled={submit.isPending}>{submit.isPending ? "Invio…" : "Invia richiesta"}</button></div>
          </form>
        )}
    </main>
  );
}
