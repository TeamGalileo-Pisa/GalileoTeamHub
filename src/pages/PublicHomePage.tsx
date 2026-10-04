import { ArrowRight, Mail, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

export function PublicHomePage() {
  return (
    <main className="public-info-page">
      <header className="public-info-header">
        <a className="public-info-brand" href="/" aria-label="GalileoHub, pagina iniziale">
          <img src="/icons/galileohub-192-v2.png" alt="" width="44" height="44" />
          <span>GalileoHub</span>
        </a>
        <Link className="button button--primary" to="/login">
          Accedi <ArrowRight size={17} />
        </Link>
      </header>

      <section className="public-info-hero">
        <p className="eyebrow">Team Galileo Pisa</p>
        <h1>Organizzazione e comunicazioni del Team Galileo</h1>
        <p>
          GalileoHub è il gestionale interno del Team Galileo Pisa. Supporta la
          raccolta delle candidature, la prenotazione dei colloqui, le
          comunicazioni con i candidati e l’organizzazione delle attività e dei
          membri del team.
        </p>
        <p>
          Per inviare conferme di prenotazione e comunicazioni operative,
          l’applicazione usa l’account Gmail del Team Galileo. L’accesso OAuth è
          limitato a tale servizio: GalileoHub invia i messaggi e controlla la
          presenza di un messaggio già inviato tramite il suo identificativo,
          per evitare duplicati.
        </p>
        <a className="button button--primary" href="mailto:info.teamgalileo@gmail.com">
          <Mail size={17} /> Contatta il Team Galileo
        </a>
      </section>

      <section className="public-info-links" aria-label="Informazioni legali">
        <article>
          <ShieldCheck size={21} />
          <h2>Privacy</h2>
          <p>Consulta l’informativa sul trattamento dei dati in GalileoHub.</p>
          <Link to="/privacy">Leggi l’informativa privacy</Link>
        </article>
        <article>
          <ArrowRight size={21} />
          <h2>Termini di servizio</h2>
          <p>Consulta le condizioni di utilizzo del gestionale.</p>
          <Link to="/terms">Leggi i termini di servizio</Link>
        </article>
      </section>

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
