export interface GuideSection {
  id: string;
  title: string;
  text: string;
  steps: string[];
  warning?: string;
  adminOnly?: boolean;
}
export const guideSections: GuideSection[] = [
  {
    id: "accesso",
    title: "Accesso e cambio password",
    text: "Lo username non è un indirizzo email.",
    steps: [
      "Accedi con lo username assegnato.",
      "Al primo accesso scegli una password nuova e ripetila.",
      "Se hai dimenticato la password contatta Amministrazione. Non usare il recupero via email dell’indirizzo Auth interno.",
    ],
    warning:
      "Non condividere credenziali, token o link privati in spazi pubblici.",
  },
  {
    id: "disponibilita",
    title: "Trovare una disponibilità",
    text: "La tabella mostra ogni giornata, aula, nota e capacità.",
    steps: [
      "Apri Disponibilità aule.",
      "Filtra per data e aula. Attiva Posti liberi per l’intera fascia se vuoi riservarla tutta.",
      "Leggi la nota dell’Amministrazione e premi Seleziona sulla giornata scelta.",
      "Scegli area e campagna nel modulo.",
    ],
    warning:
      "Il filtro usa il picco di occupazione dell’intera finestra. Una finestra 2/2 potrebbe avere sottofasce libere: togli il filtro e verifica un intervallo più breve.",
  },
  {
    id: "fascia",
    title: "Scegliere giorno e fascia",
    text: "Gli orari sono sempre riferiti a Europe/Rome.",
    steps: [
      "Seleziona una disponibilità: inizio e fine vengono precompilati.",
      "Restringi gli orari rimanendo all’interno dei limiti mostrati.",
      "Verifica la capacità nella tua sottofascia e premi Conferma fascia.",
      "Passa a Sessioni e slot per utilizzare la fascia assegnata.",
    ],
    warning:
      "Le vecchie finestre su più giorni sono indicate come precedenti/legacy: controlla anche la data finale.",
  },
  {
    id: "capacita",
    title: "Capire 0/2, 1/2 e 2/2",
    text: "Il primo numero è il massimo di colloqui contemporanei già assegnati, il secondo è la capacità.",
    steps: [
      "0/2: entrambe le postazioni sono libere.",
      "1/2: puoi aggiungere un colloquio contemporaneo.",
      "2/2: scegli un altro intervallo o un’altra aula.",
      "09:00–10:00 e 10:00–11:00 sono consecutivi e non si sovrappongono.",
    ],
  },
  {
    id: "sessioni",
    title: "Creare una sessione e generare slot",
    text: "Una sessione usa una fascia assegnata alla tua area.",
    steps: [
      "Apri Sessioni e slot.",
      "Scegli la fascia, inserisci un nome riconoscibile e la durata in minuti.",
      "Premi Crea e genera slot: entrambe le operazioni sono salvate insieme.",
      "Apri Gestisci per vedere gli orari effettivi. Un eventuale resto più corto della durata scelta non genera uno slot.",
    ],
  },
  {
    id: "slot",
    title: "Modificare o chiudere uno slot",
    text: "Gli appuntamenti prenotati si gestiscono dal Calendario.",
    steps: [
      "Apri Gestisci nella riga della sessione.",
      "Su uno slot libero premi Modifica orario e scegli inizio e fine dentro la fascia.",
      "Premi Chiudi slot per renderlo non prenotabile; Riapri per riabilitarlo.",
      "Elimina è consentito solo se lo slot non è mai stato prenotato.",
    ],
    warning:
      "Anche una prenotazione annullata costituisce storico: l’orario di quel vecchio slot non si riscrive.",
  },
  {
    id: "chiusura",
    title: "Chiudere e riaprire una sessione",
    text: "Chiudere non annulla gli appuntamenti confermati.",
    steps: [
      "Apri Gestisci e premi Chiudi sessione.",
      "Conferma: vengono revocati i link e chiusi gli slot liberi.",
      "Se la fascia è ancora futura e la campagna è attiva puoi riaprire la sessione.",
      "Riapri esplicitamente gli slot desiderati e genera un nuovo link.",
    ],
  },
  {
    id: "link",
    title: "Generare, rigenerare o revocare il link candidato",
    text: "Il candidato non deve creare un account.",
    steps: [
      "Premi Genera nella sessione o in Gestisci.",
      "Copia il link e inseriscilo nella mail di convocazione.",
      "Rigenera sostituisce il link precedente: invia ai candidati quello nuovo.",
      "Revoca link impedisce nuovi accessi senza cancellare prenotazioni.",
    ],
    warning:
      "Il link completo viene mostrato solo quando lo generi. Non è recuperabile in chiaro dal database.",
  },
  {
    id: "candidato",
    title: "Come prenota il candidato",
    text: "Per nuove prenotazioni è obbligatoria l’email @studenti.unipi.it.",
    steps: [
      "Il candidato apre il link e seleziona un orario.",
      "Inserisce nome, cognome ed email universitaria.",
      "Conferma una sola volta e legge il riepilogo.",
      "Controlla Posta in arrivo e Spam per la conferma.",
    ],
    warning:
      "Le vecchie prenotazioni con altri domini restano valide. La prenotazione è salvata anche se Gmail è temporaneamente indisponibile.",
  },
  {
    id: "calendario",
    title: "Consultare Lista e Calendario",
    text: "Ogni vista usa la settimana selezionata, senza limitarsi ai primi dodici colloqui.",
    steps: [
      "Apri Calendario e scegli Lista oppure Calendario.",
      "Usa le frecce per cambiare settimana, Oggi per tornare alla corrente o seleziona una data.",
      "Nella griglia l’altezza segue la durata reale dell’appuntamento.",
      "Clicca un appuntamento per vedere email, aula, area e stato. Sul telefono scorri orizzontalmente la settimana oppure usa Lista.",
    ],
  },
  {
    id: "sposta",
    title: "Spostare una prenotazione",
    text: "Il Capo Area può scegliere solo slot della propria area, nella stessa campagna.",
    steps: [
      "Apri la prenotazione dal Calendario.",
      "Scegli uno degli slot liberi proposti.",
      "Premi Conferma spostamento.",
      "Il vecchio slot si libera e viene accodata un’email con i nuovi dettagli.",
    ],
    warning:
      "Se qualcuno occupa lo slot nel frattempo, lo spostamento viene rifiutato: aggiorna e scegli un altro orario.",
  },
  {
    id: "annulla",
    title: "Annullare una prenotazione",
    text: "L’annullamento conserva lo storico.",
    steps: [
      "Apri l’appuntamento.",
      "Premi Annulla prenotazione e leggi la conferma.",
      "Conferma l’annullamento: il candidato riceverà una notifica.",
      "La riga rimane nel Calendario con stato Annullato.",
    ],
  },
  {
    id: "bacheca",
    title: "Leggere la Bacheca",
    text: "Il badge indica i messaggi non letti della tua area.",
    steps: [
      "Apri Bacheca dal menu.",
      "Leggi i messaggi importanti e in evidenza.",
      "Segna come letto dopo aver preso visione.",
      "Le comunicazioni scadute non vengono più mostrate ai Capi Area.",
    ],
  },
  {
    id: "problemi",
    title: "FAQ e problemi comuni",
    text: "Non ripetere un’operazione se non sai se è già riuscita: aggiorna prima i dati.",
    steps: [
      "Nessuna fascia? Verifica data, filtri, campagna attiva e disponibilità aperte.",
      "Aula piena? Prova una sottofascia diversa e controlla la capacità aggiornata.",
      "Link non valido? Chiedi al Capo Area un nuovo link.",
      "Email non arrivata? Controlla Spam e chiedi ad Amministrazione di verificare Diagnostica email.",
      "Errore persistente? Comunica ad Amministrazione schermata, operazione e orario, senza inviare password o token.",
    ],
  },
  {
    id: "admin-campagne",
    title: "Creare, modificare e archiviare recruitment",
    adminOnly: true,
    text: "Una nuova campagna nasce come bozza.",
    steps: [
      "Apri Recruitment e inserisci nome e date.",
      "Crea la bozza e premi Attiva per collegare tutte le aree attive.",
      "Apri Modifica / Gestisci per cambiare nome, date o stato.",
      "Usa Chiudi / Archivia quando termina il recruitment. Solo le bozze senza dati dipendenti possono essere eliminate.",
    ],
    warning:
      "Le nuove date devono contenere tutte le fasce già assegnate, anche storiche. Archiviare non invia annullamenti ai candidati.",
  },
  {
    id: "admin-aule",
    title: "Creare un’aula: limite fisico e capacità operativa",
    adminOnly: true,
    text: "Il limite fisico è un tetto, la capacità operativa è quella concessa in una specifica giornata.",
    steps: [
      "In Disponibilità aule compila Nuova aula.",
      "Inserisci nome e posizione.",
      "Imposta il limite fisico, per esempio A27 = 2 postazioni simultanee.",
      "Per ciascuna disponibilità scegli una capacità non superiore al limite, per esempio 1 se vuoi usare solo un tavolo.",
    ],
  },
  {
    id: "admin-periodo",
    title: "Aprire un giorno o un periodo di più giorni",
    adminOnly: true,
    text: "Esempio: 21–25 settembre 2026, lunedì–venerdì, 08:30–18:00 crea cinque finestre separate.",
    steps: [
      "Scegli l’aula nel modulo Apri disponibilità giornaliere.",
      "Per un solo giorno inserisci la stessa data iniziale e finale; per un periodo indica entrambi gli estremi.",
      "Scegli ora inizio, ora fine e i giorni della settimana.",
      "Inserisci capacità e nota, per esempio Disponibilità di lavagna.",
      "Controlla l’anteprima con numero ed elenco delle date, quindi conferma.",
      "Nella tabella ogni giornata è una riga e le giornate create insieme hanno lo stesso Gruppo.",
    ],
    warning:
      "Non vengono create finestre notturne. Se una giornata si sovrappone a una disponibilità esistente, l’intero gruppo viene rifiutato senza inserimenti parziali.",
  },
  {
    id: "admin-modifica-disponibilita",
    title: "Modificare disponibilità",
    adminOnly: true,
    text: "Le vecchie finestre non vengono spezzate automaticamente.",
    steps: [
      "Trova la giornata con i filtri.",
      "Premi Modifica per cambiare orari, capacità e nota della singola riga.",
      "Salva: il sistema impedisce di escludere fasce già assegnate o ridurre la capacità sotto l’utilizzo.",
      "Annulla è possibile solo se non ci sono colloqui confermati.",
    ],
  },
  {
    id: "admin-aree",
    title: "Gestire aree",
    adminOnly: true,
    text: "Nome e slug non cambiano l’identità dell’area né il suo storico.",
    steps: [
      "Apri Aree del Team.",
      "Usa Modifica / Gestisci per cambiare nome o identificativo.",
      "Deseleziona Area attiva e salva per disattivare; riselezionala per riattivare.",
      "Elimina richiede conferma ed è consentito solo senza campagne, account, sessioni, comunicazioni o altri collegamenti.",
    ],
  },
  {
    id: "admin-account",
    title: "Gestire account e ruoli",
    adminOnly: true,
    text: "Ogni Capo Area ha una sola assegnazione attiva.",
    steps: [
      "Crea l’account con username, nome visualizzato, ruolo e area.",
      "Comunica la password temporanea su un canale sicuro.",
      "Modifica / Gestisci permette di cambiare username, nome, ruolo, area e stato.",
      "Usa Disattivato per sospendere un account e Attivo per riattivarlo.",
      "Gli account con storico non si eliminano; deve rimanere almeno un amministratore attivo.",
    ],
  },
  {
    id: "admin-reset",
    title: "Reimpostare una password",
    adminOnly: true,
    text: "L’operazione usa la regola di reset configurata esclusivamente sul server.",
    steps: [
      "Apri Account e ruoli, quindi Modifica / Gestisci.",
      "Premi Reimposta password.",
      "Verifica lo username nel messaggio e conferma.",
      "Comunica all’utente la credenziale iniziale tramite un canale sicuro: deve cambiarla prima di utilizzare le funzioni.",
    ],
    warning:
      "Il reset usa lo username già salvato. Salva prima eventuali modifiche allo username. Le password non vengono mostrate nei log o nelle risposte API.",
  },
  {
    id: "admin-calendario",
    title: "Calendario generale e filtro area",
    adminOnly: true,
    text: "Amministrazione ha accesso globale.",
    steps: [
      "Apri Calendario e scegli Lista o Calendario.",
      "Lascia Tutte le aree per il quadro generale o seleziona un’area.",
      "Le etichette area distinguono gli appuntamenti simultanei.",
      "Apri qualsiasi appuntamento per spostarlo o annullarlo. Gli spostamenti restano nella stessa campagna per preservare la coerenza del candidato.",
    ],
  },
  {
    id: "admin-bacheca",
    title: "Pubblicare in Bacheca",
    adminOnly: true,
    text: "La Bacheca non manda email ai candidati.",
    steps: [
      "Inserisci titolo, testo e data di pubblicazione.",
      "Scegli tutte le aree o i destinatari specifici.",
      "Imposta eventuale scadenza, Importante e In evidenza.",
      "Pubblica e controlla le letture; puoi modificare o eliminare la comunicazione.",
    ],
  },
  {
    id: "admin-email",
    title: "Testare email e diagnosticare consegne",
    adminOnly: true,
    text: "Una risposta Gmail positiva significa accettazione del messaggio, non prova della ricezione nella casella.",
    steps: [
      "Configura Gmail OAuth e EMAIL_PROVIDER nei secret delle Edge Functions, mai in Vite.",
      "Usa Email di prova qui sotto con una casella reale che puoi controllare.",
      "Controlla che il mittente sia Team Galileo Pisa e verifica la ricezione, inclusa Spam.",
      "Apri Diagnostica email: pending = in coda, sending = tentativo in corso, sent = accettata da Gmail, failed = errore.",
      "Il worker passa ogni minuto, con massimo sei tentativi. Dopo aver corretto il problema usa Riprova sulle consegne fallite.",
    ],
    warning:
      "L’obiettivo dei cinque minuti dipende dalla disponibilità di Gmail. Quote, credenziali revocate o disservizi possono impedirlo; una prenotazione salvata non viene persa.",
  },
];
