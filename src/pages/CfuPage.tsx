import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Pencil, Plus, Trash2, Users } from "lucide-react";
import { CfuEvaluationFields } from "../components/CfuEvaluationFields";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../hooks/useAuth";
import { cfuErrorMessage, cfuFinalGrade, cfuScore, cfuVerdict, isCfuComplete, normalizeRatings, type CfuMember } from "../lib/cfu";
import { cfuPdf, cfuPdfFileName } from "../lib/cfu-pdf";
import { supabase } from "../lib/supabase";

interface AreaOption { id: string; name: string; enabled: boolean }
type Draft = Omit<CfuMember, "id" | "evaluated_at"> & { id?: string };
const blank: Draft = {
  first_name: "", last_name: "", student_number: "", degree: "", department: "", professor_name: "", professor_email: "", area_id: null, division: "", team_role: "",
  period_from: null, period_to: null, description: "", ratings: {},
};

const download = (bytes: Uint8Array, name: string) => {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export function CfuPage() {
  const { access } = useAuth();
  const cache = useQueryClient();
  const canManage = Boolean(access?.isTeamLeader);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const areas = useQuery({
    queryKey: ["cfu-areas"], enabled: canManage,
    queryFn: async () => {
      const [{ data: list, error: e1 }, { data: settings, error: e2 }] = await Promise.all([
        supabase.from("areas").select("id,name").eq("active", true).order("name"),
        supabase.from("cfu_area_settings").select("area_id,enabled"),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      const on = new Map((settings ?? []).map((row) => [row.area_id as string, Boolean(row.enabled)]));
      return (list ?? []).map((row) => ({ id: row.id as string, name: String(row.name), enabled: on.get(row.id as string) ?? false })) as AreaOption[];
    },
  });

  const fail = (e: unknown) => setError(cfuErrorMessage(e));

  const settings = useQuery({
    queryKey: ["cfu-settings"], enabled: canManage,
    queryFn: async () => {
      const { data, error: e } = await supabase.from("cfu_settings").select("requests_open").maybeSingle();
      if (e) throw e;
      return Boolean(data?.requests_open);
    },
  });
  const toggleRequests = useMutation({
    mutationFn: async (open: boolean) => { const { error: e } = await supabase.from("cfu_settings").update({ requests_open: open }).eq("id", true); if (e) throw e; },
    onSuccess: () => void cache.invalidateQueries({ queryKey: ["cfu-settings"] }), onError: fail,
  });

  const members = useQuery({
    queryKey: ["cfu-members"], enabled: canManage,
    queryFn: async () => {
      const { data, error: e } = await supabase.from("cfu_members").select("*").order("last_name").order("first_name");
      if (e) throw e;
      return (data ?? []).map((row) => ({ ...row, ratings: normalizeRatings(row.ratings) })) as CfuMember[];
    },
  });

  const refresh = () => void cache.invalidateQueries({ queryKey: ["cfu-members"] });

  const toggleArea = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error: e } = await supabase.from("cfu_area_settings").upsert({ area_id: id, enabled, updated_at: new Date().toISOString() });
      if (e) throw e;
    },
    onSuccess: () => void cache.invalidateQueries({ queryKey: ["cfu-areas"] }), onError: fail,
  });

  const saveMember = useMutation({
    mutationFn: async (value: Draft) => {
      const row = {
        first_name: value.first_name.trim(), last_name: value.last_name.trim(), student_number: value.student_number.trim(),
        degree: value.degree.trim(), department: value.department.trim(), professor_name: value.professor_name.trim(), professor_email: value.professor_email.trim(), area_id: value.area_id || null, division: value.division.trim(),
        team_role: value.team_role.trim(), period_from: value.period_from || null, period_to: value.period_to || null,
        description: value.description, ratings: value.ratings,
      };
      const { error: e } = value.id ? await supabase.from("cfu_members").update(row).eq("id", value.id) : await supabase.from("cfu_members").insert(row);
      if (e) throw e;
    },
    onSuccess: () => { setDraft(null); refresh(); }, onError: fail,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => { const { error: e } = await supabase.from("cfu_members").delete().eq("id", id); if (e) throw e; },
    onSuccess: refresh, onError: fail,
  });

  const importMembers = useMutation({
    mutationFn: async () => { const { data, error: e } = await supabase.rpc("cfu_import_members"); if (e) throw e; return Number(data ?? 0); },
    onSuccess: (count) => { setNotice(count ? `Importati ${count} membri dai moduli di adesione.` : "Nessun nuovo membro da importare."); refresh(); }, onError: fail,
  });

  if (!canManage) {
    return <div className="page-container"><PageHeader title="CFU" eyebrow="Accesso riservato" /><section className="panel panel__body"><p>Questa sezione è riservata al Team Leader.</p></section></div>;
  }

  const areaName = (id: string | null) => areas.data?.find((area) => area.id === id)?.name ?? "";
  const makePdf = async (member: CfuMember) => {
    setError("");
    try { download(await cfuPdf(member, { areaName: areaName(member.area_id) }), cfuPdfFileName(member)); } catch (e) { fail(e); }
  };
  const onSubmit = (event: FormEvent) => { event.preventDefault(); setError(""); if (draft) saveMember.mutate(draft); };
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => (current ? { ...current, [key]: value } : current));

  return (
    <div className="page-container">
      <PageHeader title="CFU" eyebrow="Riconoscimento CFU" description="Scegli quali aree possono compilare le valutazioni, controlla i punteggi e scarica la scheda PDF di ogni membro."
        actions={<>
          <button className="button" type="button" disabled={importMembers.isPending} onClick={() => importMembers.mutate()}><Users size={17} /> Importa dai moduli di adesione</button>
          <button className="button button--primary" type="button" onClick={() => { setError(""); setDraft({ ...blank }); }}><Plus size={17} /> Aggiungi membro</button>
        </>} />
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      <section className="panel panel__body">
        <h2>Link pubblico per le richieste dei membri</h2>
        <p className="table-secondary">I membri inseriscono i propri dati da questo link; la scheda compare qui sotto e il Capo Area della loro area aggiunge descrizione e crocette.</p>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={settings.data === true} disabled={toggleRequests.isPending || settings.isPending} onChange={(event) => toggleRequests.mutate(event.target.checked)} />
          Richieste aperte
        </label>
        <p><a href={`${window.location.origin}/richiesta-cfu`} target="_blank" rel="noreferrer">{`${window.location.origin}/richiesta-cfu`}</a>{" "}
          <button className="button" type="button" onClick={() => void navigator.clipboard?.writeText(`${window.location.origin}/richiesta-cfu`).then(() => setNotice("Link copiato."))}>Copia link</button></p>
      </section>

      <section className="panel panel__body">
        <h2>Aree i cui Capi Area possono compilare</h2>
        <p className="table-secondary">Un Capo Area abilitato vede solo nome e cognome dei membri della propria area e può scrivere la descrizione e segnare le crocette.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px" }}>
          {(areas.data ?? []).map((area) => (
            <label key={area.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={area.enabled} disabled={toggleArea.isPending}
                onChange={(event) => toggleArea.mutate({ id: area.id, enabled: event.target.checked })} />
              {area.name}
            </label>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th scope="col">Cognome e nome</th><th scope="col">Area</th><th scope="col">Valutazione finale</th><th scope="col">Giudizio</th><th scope="col"><span className="sr-only">Azioni</span></th></tr></thead>
            <tbody>
              {(members.data ?? []).map((member) => {
                const score = cfuScore(member.ratings);
                const complete = isCfuComplete(member.ratings);
                return (
                  <tr key={member.id}>
                    <td>{member.last_name} {member.first_name}</td>
                    <td>{areaName(member.area_id) || <span className="table-secondary">Non assegnata</span>}</td>
                    <td>{member.evaluated_at ? cfuFinalGrade(score) : "—"}{member.evaluated_at && !complete && <span className="table-secondary"> (incompleta)</span>}</td>
                    <td>{member.evaluated_at ? (cfuVerdict(score) === "favorevole" ? "Favorevole" : "Contrario") : "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="icon-button" type="button" title="Scarica PDF" aria-label={`Scarica PDF di ${member.last_name} ${member.first_name}`} onClick={() => void makePdf(member)}><Download size={17} /></button>
                      <button className="icon-button" type="button" title="Modifica" aria-label={`Modifica ${member.last_name} ${member.first_name}`} onClick={() => { setError(""); setDraft({ ...member }); }}><Pencil size={17} /></button>
                      <button className="icon-button" type="button" title="Elimina" aria-label={`Elimina ${member.last_name} ${member.first_name}`}
                        onClick={() => { if (window.confirm(`Eliminare ${member.last_name} ${member.first_name} dalla lista CFU?`)) remove.mutate(member.id); }}><Trash2 size={17} /></button>
                    </td>
                  </tr>
                );
              })}
              {members.data?.length === 0 && <tr><td colSpan={5}>Nessun membro. Importa dai moduli di adesione o aggiungine uno.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {draft && (
        <Modal title={draft.id ? "Modifica membro" : "Aggiungi membro"} onClose={() => setDraft(null)}>
          <form className="panel__body form-grid" onSubmit={onSubmit}>
            <label className="form-field">Nome<input className="input" required value={draft.first_name} onChange={(e) => set("first_name", e.target.value)} /></label>
            <label className="form-field">Cognome<input className="input" required value={draft.last_name} onChange={(e) => set("last_name", e.target.value)} /></label>
            <label className="form-field">Matricola<input className="input" value={draft.student_number} onChange={(e) => set("student_number", e.target.value)} /></label>
            <label className="form-field">Corso di Studi<input className="input" value={draft.degree} onChange={(e) => set("degree", e.target.value)} /></label>
            <label className="form-field">Docente del Corso di Laurea<input className="input" value={draft.professor_name} onChange={(e) => set("professor_name", e.target.value)} /></label>
            <label className="form-field">Mail del docente<input className="input" type="email" value={draft.professor_email} onChange={(e) => set("professor_email", e.target.value)} /></label>
            <label className="form-field">Dipartimento / Area<input className="input" value={draft.department} onChange={(e) => set("department", e.target.value)} /></label>
            <label className="form-field">Divisione / Settore (testo sulla scheda)<input className="input" value={draft.division} onChange={(e) => set("division", e.target.value)} /></label>
            <label className="form-field">Ruolo ricoperto nel Team<input className="input" value={draft.team_role} onChange={(e) => set("team_role", e.target.value)} /></label>
            <label className="form-field">Area del Capo Area che valuta
              <select className="input" value={draft.area_id ?? ""} onChange={(e) => set("area_id", e.target.value || null)}>
                <option value="">Non assegnata</option>
                {(areas.data ?? []).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
              </select>
            </label>
            <label className="form-field">Periodo: da<input className="input" type="date" value={draft.period_from ?? ""} onChange={(e) => set("period_from", e.target.value || null)} /></label>
            <label className="form-field">Periodo: a<input className="input" type="date" value={draft.period_to ?? ""} onChange={(e) => set("period_to", e.target.value || null)} /></label>
            <CfuEvaluationFields description={draft.description} ratings={draft.ratings} onDescription={(value) => set("description", value)}
              onRating={(criterion, level) => set("ratings", { ...draft.ratings, [criterion]: level })} showResult />
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="form-actions">
              <button className="button" type="button" onClick={() => setDraft(null)}>Annulla</button>
              <button className="button button--primary" type="submit" disabled={saveMember.isPending}>{saveMember.isPending ? "Salvataggio…" : "Salva"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
