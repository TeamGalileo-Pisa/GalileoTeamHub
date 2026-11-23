import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CfuEvaluationFields } from "../components/CfuEvaluationFields";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { cfuErrorMessage, isCfuComplete, normalizeRatings, type CfuLeadMember, type CfuRatings } from "../lib/cfu";
import { supabase } from "../lib/supabase";

// Vista del Capo Area: solo nome e cognome, descrizione del lavoro svolto e crocette. Nient'altro.
export function CfuLeadPage() {
  const cache = useQueryClient();
  const [editing, setEditing] = useState<CfuLeadMember | null>(null);
  const [description, setDescription] = useState("");
  const [ratings, setRatings] = useState<CfuRatings>({});
  const [error, setError] = useState("");

  const members = useQuery({
    queryKey: ["cfu-lead-members"],
    queryFn: async () => {
      const { data, error: rpcError } = await supabase.rpc("cfu_lead_members");
      if (rpcError) throw rpcError;
      return ((data ?? []) as CfuLeadMember[]).map((row) => ({ ...row, ratings: normalizeRatings(row.ratings) }));
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const { error: rpcError } = await supabase.rpc("cfu_lead_save", { p_member: editing.id, p_description: description, p_ratings: ratings });
      if (rpcError) throw rpcError;
    },
    onSuccess: () => { setEditing(null); void cache.invalidateQueries({ queryKey: ["cfu-lead-members"] }); },
    onError: (e) => setError(cfuErrorMessage(e)),
  });

  const open = (member: CfuLeadMember) => {
    setEditing(member); setDescription(member.description); setRatings(member.ratings); setError("");
  };

  return (
    <div className="page-container">
      <PageHeader title="CFU" eyebrow="Valutazione dei membri" description="Descrivi il lavoro svolto da ciascun membro e segna il livello per ogni criterio." />
      {members.error && <p className="form-error" role="alert">{cfuErrorMessage(members.error)}</p>}
      <section className="panel">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th scope="col">Cognome e nome</th><th scope="col">Stato</th><th scope="col"><span className="sr-only">Azioni</span></th></tr></thead>
            <tbody>
              {(members.data ?? []).map((member) => (
                <tr key={member.id}>
                  <td>{member.last_name} {member.first_name}</td>
                  <td>{member.evaluated_at ? (isCfuComplete(member.ratings) ? "Compilata" : "Incompleta") : "Da compilare"}</td>
                  <td><button className="button" type="button" onClick={() => open(member)}>Compila</button></td>
                </tr>
              ))}
              {members.data?.length === 0 && <tr><td colSpan={3}>Nessun membro assegnato alla tua area.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {editing && (
        <Modal title={`${editing.last_name} ${editing.first_name}`} onClose={() => setEditing(null)}>
          <form className="panel__body form-grid" onSubmit={(event) => { event.preventDefault(); setError(""); save.mutate(); }}>
            <CfuEvaluationFields description={description} ratings={ratings} onDescription={setDescription}
              onRating={(criterion, level) => setRatings((current) => ({ ...current, [criterion]: level }))} disabled={save.isPending} />
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="form-actions">
              <button className="button" type="button" onClick={() => setEditing(null)}>Annulla</button>
              <button className="button button--primary" type="submit" disabled={save.isPending}>{save.isPending ? "Salvataggio…" : "Salva"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
