import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { LoadingScreen } from "../components/LoadingScreen";
import {
  getPublicLegalDocument,
  type LegalDocument,
} from "../lib/hub-enhancements";

export function PublicLegalPage({
  documentKey,
}: {
  documentKey: LegalDocument["key"];
}) {
  const documentQuery = useQuery({
    queryKey: ["public-legal-document", documentKey],
    queryFn: () => getPublicLegalDocument(documentKey),
  });

  return (
    <main className="public-info-page public-legal-page">
      <header className="public-info-header">
        <Link className="public-info-brand" to="/">
          <img src="/icons/galileohub-192-v2.png" alt="" width="44" height="44" />
          <span>GalileoHub</span>
        </Link>
        <Link className="button button--secondary" to="/">
          <ArrowLeft size={17} /> Torna alla home
        </Link>
      </header>

      {documentQuery.isLoading ? (
        <LoadingScreen label="Caricamento documento" />
      ) : documentQuery.error || !documentQuery.data ? (
        <section className="public-legal-card" role="alert">
          <h1>Documento non disponibile</h1>
          <p>Riprova più tardi o contatta info.teamgalileo@gmail.com.</p>
          <Link to="/">Torna alla home di GalileoHub</Link>
        </section>
      ) : (
        <article className="public-legal-card">
          <p className="eyebrow">Team Galileo Pisa</p>
          <h1>{documentQuery.data.title}</h1>
          <div className="public-legal-body">{documentQuery.data.body}</div>
          <small>
            Versione {documentQuery.data.version} · Aggiornata il{" "}
            {new Date(documentQuery.data.updatedAt).toLocaleDateString("it-IT")}
          </small>
        </article>
      )}

      <footer className="public-info-footer">
        <span>Team Galileo Pisa</span>
        <nav aria-label="Link legali">
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Termini di servizio</Link>
          <a href="mailto:info.teamgalileo@gmail.com">Contatti</a>
        </nav>
      </footer>
    </main>
  );
}
