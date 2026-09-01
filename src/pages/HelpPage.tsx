import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { BookOpen, MailCheck, Search, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../hooks/useAuth";
import { sendAdminTestEmail } from "../lib/data";

interface GuideSection {
  id: string;
  title: string;
  text: string;
  adminOnly?: boolean;
}

const guideSections: GuideSection[] = [
  {
    id: "accesso",
    title: "Accesso",
    text: "Accedi con lo username assegnato. Al primo accesso il gestionale richiede di cambiare la password iniziale. Per uscire usa l’icona in basso nel menu laterale. Se dimentichi la password, contatta Amministrazione: non esiste il recupero tramite l’email sintetica di login.",
  },
  {
    id: "dashboard",
    title: "Dashboard",
    text: "Riepiloga colloqui di oggi e della settimana, slot liberi, prenotazioni e prossimi appuntamenti. I Capi Area vedono soltanto i dati della propria area; Amministrazione vede il quadro generale.",
  },
  {
    id: "disponibilita",
    title: "Disponibilità e capacità",
    text: "Scegli una finestra aperta da Amministrazione e indica una sottofascia interamente contenuta. 1/2 significa che uno dei due colloqui simultanei è già occupato; 2/2 e COMPLETA significano che l’intervallo non ha posti. Gli intervalli sono [inizio, fine): 09:00–10:00 non si sovrappone a 10:00–11:00. Leggi sempre la nota Amministrazione prima di confermare.",
  },
  {
    id: "sessioni",
    title: "Sessioni e slot",
    text: "Dopo aver preso una fascia, apri Sessioni e slot, scegli la fascia, assegna un nome e la durata di ciascun colloquio. Il pulsante Crea e genera slot suddivide automaticamente tutto l’intervallo.",
  },
  {
    id: "link-candidato",
    title: "Link candidato",
    text: "Premi Genera nella riga della sessione e poi Copia link. Il candidato non deve avere un account. Se premi Rigenera, il vecchio link viene revocato immediatamente e funziona soltanto quello nuovo.",
  },
  {
    id: "prenotazioni",
    title: "Prenotazioni",
    text: "Il candidato apre il link privato, sceglie uno slot e inserisce nome, cognome ed email. Dopo la conferma lo slot non può più essere scelto da altri. Il gestionale mostra l’appuntamento nel calendario dell’area.",
  },
  {
    id: "calendario-email",
    title: "Calendario ed email",
    text: "Il Calendario mostra data, orario, aula, candidato e area. Le notifiche esterne comprendono conferma, promemoria, modifica e annullamento e usano l’identità Team Galileo Pisa. La Bacheca, invece, non invia email.",
  },
  {
    id: "bacheca",
    title: "Bacheca",
    text: "Il badge nel menu indica i messaggi non letti. Apri una comunicazione e segnala che l’hai letta; i messaggi importanti e quelli in evidenza sono evidenziati. I messaggi scaduti non vengono più mostrati ai Capi Area.",
  },
  {
    id: "problemi",
    title: "Problemi comuni",
    text: "Non vedi fasce: verifica che esista una campagna attiva e una disponibilità futura. Aula piena: prova un intervallo diverso. Sessione non creabile: la fascia potrebbe essere già usata. Link non generabile: verifica sessione e slot. Link scaduto o slot terminati: chiedi un nuovo link al Capo Area. Prenotazione non disponibile: aggiorna e scegli un altro slot.",
  },
  {
    id: "admin-recruitment",
    title: "Amministrazione: recruitment, aree e account",
    adminOnly: true,
    text: "Crea una campagna Recruitment e attivala per collegarla alle aree. In Aree gestisci l’elenco organizzativo; in Account crea soltanto ruoli amministrativi o Capi Area e assegna ogni Capo Area alla sua area.",
  },
  {
    id: "admin-aule",
    title: "Amministrazione: aule e disponibilità",
    adminOnly: true,
    text: "Quando crei un’aula puoi impostare un limite fisico. Per ogni disponibilità indica sempre inizio, fine, capacità simultanea e nota alle aree. La capacità della finestra non può superare il limite fisico. Puoi modificare orari, nota e capacità, ma non escludere assegnazioni esistenti né scendere sotto il picco già occupato.",
  },
  {
    id: "admin-bacheca",
    title: "Amministrazione: pubblicare in Bacheca",
    adminOnly: true,
    text: "Scegli titolo, testo, data di pubblicazione, eventuale scadenza e destinatari. Puoi selezionare tutte le aree o una combinazione specifica, oltre a Importante e In evidenza. Modifica o elimina il messaggio dalla relativa scheda.",
  },
];

const emailSchema = z.object({
  toEmail: z.string().trim().email("Inserisci un indirizzo email valido").max(254),
});

export function HelpPage() {
  const { access } = useAuth();
  const isAdmin = Boolean(access?.isAdmin);
  const [search, setSearch] = useState("");
  const [emailSuccess, setEmailSuccess] = useState(false);
  const emailForm = useForm<z.infer<typeof emailSchema>>({
    resolver: zodResolver(emailSchema),
  });
  const emailMutation = useMutation({
    mutationFn: ({ toEmail }: z.infer<typeof emailSchema>) =>
      sendAdminTestEmail(toEmail),
    onMutate: () => setEmailSuccess(false),
    onSuccess: () => {
      setEmailSuccess(true);
      emailForm.reset();
    },
  });
  const visibleSections = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("it");
    return guideSections.filter(
      (section) =>
        (!section.adminOnly || isAdmin) &&
        (!normalized ||
          `${section.title} ${section.text}`.toLocaleLowerCase("it").includes(normalized)),
    );
  }, [isAdmin, search]);

  return (
    <div className="page-container">
      <PageHeader
        eyebrow="Guida interna"
        title="Assistenza"
        description="Istruzioni pratiche per usare il gestionale e risolvere i problemi più comuni."
      />

      <div className="help-layout">
        <aside className="panel help-index">
          <div className="panel__header"><div><h2>Indice</h2><p>Cerca o scegli una sezione</p></div><BookOpen size={20} /></div>
          <div className="panel__body">
            <label className="search-field" htmlFor="help-search">
              <Search size={17} />
              <input id="help-search" className="input" type="search" placeholder="Cerca nella guida" value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <nav className="help-links" aria-label="Indice assistenza">
              {visibleSections.map((section) => <a href={`#${section.id}`} key={section.id}>{section.title}</a>)}
            </nav>
          </div>
        </aside>

        <div className="help-sections">
          {visibleSections.map((section) => (
            <section className={`panel help-section ${section.adminOnly ? "help-section--admin" : ""}`} id={section.id} key={section.id}>
              <div className="panel__header">
                <div><h2>{section.title}</h2>{section.adminOnly && <p>Visibile solo ad Amministrazione</p>}</div>
                {section.adminOnly && <ShieldCheck size={20} />}
              </div>
              <div className="panel__body"><p>{section.text}</p></div>
            </section>
          ))}
          {!visibleSections.length && <div className="panel panel__body">Nessun argomento corrisponde alla ricerca.</div>}

          {isAdmin && (
            <section className="panel help-section help-section--admin">
              <div className="panel__header"><div><h2>Email di prova</h2><p>Invio diretto riservato ad Amministrazione, senza creare prenotazioni.</p></div><MailCheck size={20} /></div>
              <form className="panel__body form-grid" onSubmit={emailForm.handleSubmit((values) => emailMutation.mutate(values))}>
                <div className="form-field form-field--full">
                  <label htmlFor="test-email">Destinatario di prova</label>
                  <input id="test-email" className="input" type="email" placeholder="nome@esempio.it" {...emailForm.register("toEmail")} />
                  {emailForm.formState.errors.toEmail && <span className="field-error">{emailForm.formState.errors.toEmail.message}</span>}
                </div>
                {emailMutation.error && <div className="form-error form-field--full" role="alert">{emailMutation.error.message}</div>}
                {emailSuccess && <div className="form-success form-field--full" role="status">Email di prova accettata da Gmail.</div>}
                <div className="form-actions"><button className="button button--primary" type="submit" disabled={emailMutation.isPending}><MailCheck size={17} /> {emailMutation.isPending ? "Invio…" : "Invia email di prova"}</button></div>
              </form>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
