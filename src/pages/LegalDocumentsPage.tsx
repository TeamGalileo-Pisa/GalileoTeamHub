import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Save, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import {
  listLegalDocuments,
  updateLegalDocument,
  type LegalDocument,
} from "../lib/hub-enhancements";

const documentLabels: Record<LegalDocument["key"], { label: string; description: string }> = {
  privacy: {
    label: "Informativa Privacy",
    description: "È il testo mostrato obbligatoriamente agli studenti prima della conferma della prenotazione.",
  },
  terms: {
    label: "Termini di Servizio",
    description: "Condizioni di utilizzo di GalileoHub gestite dall'Amministrazione.",
  },
};

export function LegalDocumentsPage() {
  const queryClient = useQueryClient();
  const documentsQuery = useQuery({
    queryKey: ["legal-documents"],
    queryFn: listLegalDocuments,
  });
  const [selectedKey, setSelectedKey] = useState<LegalDocument["key"]>("privacy");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [success, setSuccess] = useState<string | null>(null);

  const selected = useMemo(
    () => documentsQuery.data?.find((document) => document.key === selectedKey) ?? null,
    [documentsQuery.data, selectedKey],
  );

  useEffect(() => {
    if (!selected) return;
    setTitle(selected.title);
    setBody(selected.body);
    setSuccess(null);
  }, [selected]);

  const saveMutation = useMutation({
    mutationFn: () => updateLegalDocument({ key: selectedKey, title, body }),
    onSuccess: async (result) => {
      setSuccess(`${documentLabels[result.key].label} aggiornata. Nuova versione: ${result.version}.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["legal-documents"] }),
        queryClient.invalidateQueries({ queryKey: ["public-privacy-document"] }),
      ]);
    },
  });

  const dirty = Boolean(selected && (title !== selected.title || body !== selected.body));

  return (
    <div className="page-container">
      <PageHeader
        eyebrow="Amministrazione"
        title="Termini di Servizio e Privacy"
        description="Leggi e modifica i testi ufficiali usati da GalileoHub. Ogni salvataggio crea una nuova versione del documento."
      />

      <section className="panel legal-documents-panel">
        <div className="legal-document-tabs" role="tablist" aria-label="Documenti legali">
          {(["privacy", "terms"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selectedKey === key}
              className={`button ${selectedKey === key ? "button--primary" : "button--secondary"}`}
              onClick={() => setSelectedKey(key)}
            >
              {key === "privacy" ? <ShieldCheck size={17} /> : <FileText size={17} />}
              {documentLabels[key].label}
            </button>
          ))}
        </div>

        {documentsQuery.isLoading ? (
          <div className="table-loading">Caricamento documenti…</div>
        ) : documentsQuery.error ? (
          <div className="form-error" role="alert">{documentsQuery.error.message}</div>
        ) : selected ? (
          <div className="panel__body legal-editor">
            <div className="admin-note">
              <strong>{documentLabels[selected.key].label}</strong>
              <p>{documentLabels[selected.key].description}</p>
              <small>
                Versione attuale {selected.version} · ultimo aggiornamento {new Date(selected.updatedAt).toLocaleString("it-IT")}
              </small>
            </div>

            <label className="form-field">
              Titolo
              <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} />
            </label>

            <label className="form-field">
              Testo
              <textarea
                className="textarea legal-document-textarea"
                rows={16}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={30000}
              />
            </label>

            {selected.key === "privacy" && (
              <div className="admin-note">
                <strong>Effetto sul modulo pubblico</strong>
                <p>
                  Dopo il salvataggio gli studenti vedranno questa nuova versione. Una prenotazione può essere confermata soltanto dopo l'accettazione esplicita della versione corrente.
                </p>
              </div>
            )}

            {success && <div className="form-success" role="status">{success}</div>}
            {saveMutation.error && <div className="form-error" role="alert">{saveMutation.error.message}</div>}

            <div className="form-actions">
              <button
                type="button"
                className="button button--secondary"
                disabled={!dirty || saveMutation.isPending}
                onClick={() => {
                  setTitle(selected.title);
                  setBody(selected.body);
                }}
              >
                Ripristina modifiche non salvate
              </button>
              <button
                type="button"
                className="button button--primary"
                disabled={!dirty || saveMutation.isPending || title.trim().length < 3 || body.trim().length < 20}
                onClick={() => saveMutation.mutate()}
              >
                <Save size={17} /> {saveMutation.isPending ? "Salvataggio…" : "Salva nuova versione"}
              </button>
            </div>
          </div>
        ) : (
          <div className="form-error" role="alert">Documento non disponibile.</div>
        )}
      </section>
    </div>
  );
}
