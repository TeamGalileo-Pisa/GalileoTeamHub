import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Brand } from "../components/Brand";
import { cfuErrorMessage } from "../lib/cfu";
import { supabase } from "../lib/supabase";

interface PublicInfo { open: boolean; areas: { id: string; name: string }[] }

// Link pubblico: il membro inserisce i propri dati per la richiesta di riconoscimento CFU.
export function CfuRequestPage() {
  const [form, setForm] = useState({
    first_name: "", last_name: "", student_number: "", degree: "", department: "", area_id: "", division: "", team_role: "", period_from: "", period_to: "",
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
        : submit.isSuccess ? <p role="status"><strong>Richiesta inviata.</strong> Il Team Leader riceverà i tuoi dati e la valutazione del tuo Capo Area.</p>
        : (
          <form className="form-grid" onSubmit={onSubmit}>
            <p>Inserisci i tuoi dati per la richiesta di riconoscimento dei CFU per l'attività svolta nel Team.</p>
            <label className="form-field">Nome<input className="input" required maxLength={120} value={form.first_name} onChange={(e) => set("first_name", e.target.value)} /></label>
            <label className="form-field">Cognome<input className="input" required maxLength={120} value={form.last_name} onChange={(e) => set("last_name", e.target.value)} /></label>
            <label className="form-field">Matricola<input className="input" required maxLength={40} value={form.student_number} onChange={(e) => set("student_number", e.target.value)} /></label>
            <label className="form-field">Corso di Studi<input className="input" maxLength={200} value={form.degree} onChange={(e) => set("degree", e.target.value)} /></label>
            <label className="form-field">Dipartimento<input className="input" maxLength={200} value={form.department} onChange={(e) => set("department", e.target.value)} /></label>
            <label className="form-field">Area / Divisione di appartenenza
              <select className="input" required value={form.area_id} onChange={(e) => {
                const area = info.data.areas.find((item) => item.id === e.target.value);
                setForm((current) => ({ ...current, area_id: e.target.value, division: area?.name ?? "" }));
              }}>
                <option value="">Seleziona…</option>
                {info.data.areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
              </select>
            </label>
            <label className="form-field">Ruolo ricoperto nel Team<input className="input" maxLength={200} value={form.team_role} onChange={(e) => set("team_role", e.target.value)} /></label>
            <label className="form-field">Periodo di attività: da<input className="input" type="date" required value={form.period_from} onChange={(e) => set("period_from", e.target.value)} /></label>
            <label className="form-field">Periodo di attività: a<input className="input" type="date" required value={form.period_to} onChange={(e) => set("period_to", e.target.value)} /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="form-actions"><button className="button button--primary" type="submit" disabled={submit.isPending}>{submit.isPending ? "Invio…" : "Invia richiesta"}</button></div>
          </form>
        )}
    </main>
  );
}
