import { ArrowLeft, Compass } from "lucide-react";
import { Link } from "react-router-dom";
import { Brand } from "../components/Brand";

export function NotFoundPage() {
  return (
    <main className="not-found">
      <Brand />
      <span className="not-found__icon">
        <Compass size={28} />
      </span>
      <p className="eyebrow">Errore 404</p>
      <h1>Questa pagina non esiste.</h1>
      <p>Controlla il link oppure torna al gestionale.</p>
      <Link className="button button--primary" to="/">
        <ArrowLeft size={17} /> Torna alla dashboard
      </Link>
    </main>
  );
}
