import { ArrowRight, Mail, ShieldCheck } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { useAuth } from "../hooks/useAuth";

export function PublicHomePage() {
  const { access, loading } = useAuth();
  const installedApp = Capacitor.isNativePlatform() ||
    (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (installedApp) {
    if (loading) return <main className="page-container">Caricamento GalileoHub…</main>;
    const destination = access?.isAdmin ? "/admin" : access?.isMember ? "/membri" : access ? "/area" : "/login";
    return <Navigate to={destination} replace />;
  }
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

      <section className="public-info-links" aria-label="Installazione privata di GalileoHub">
        <article>
          <h2>Windows</h2>
          <p>Apri GalileoHub in Edge o Chrome e scegli Installa app dal menu del browser o dall’icona nella barra degli indirizzi. Le notifiche push non vengono usate sui computer.</p>
        </article>
        <article>
          <h2>Linux</h2>
          <p>Apri GalileoHub in Chrome o Chromium e scegli Installa pagina come app dal menu del browser. Le notifiche push non vengono usate sui computer Linux.</p>
        </article>
        <article>
          <h2>Android</h2>
          <p>Apri il link in Chrome e scegli Installa app o Aggiungi a schermata Home. Non serve passare dal Play Store.</p>
        </article>
        <article>
          <h2>iPhone e iPad</h2>
          <p>Apri il link in Safari, tocca Condividi e scegli Aggiungi alla schermata Home. Le notifiche push mobili richiedono iOS/iPadOS 16.4 o successivo.</p>
        </article>
        <article>
          <h2>Mac</h2>
          <p>In Safari scegli File → Aggiungi al Dock; in Chrome o Edge usa Installa GalileoHub dal menu del browser. Le notifiche push non vengono usate sui computer Mac.</p>
        </article>
        <article>
          <h2>Notifiche sui dispositivi mobili</h2>
          <p>Le notifiche push sono attive solo su Android, iPhone e iPad. Su computer puoi accedere e usare tutte le funzioni senza autorizzare notifiche.</p>
        </article>
        <article>
          <h2>Distribuzione privata</h2>
          <p>È la stessa app su tutti i dispositivi: condividi il link con i membri e loro la installano dal browser, senza store e senza pacchetti pubblici.</p>
        </article>
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

