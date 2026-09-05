import type { GuideSection } from "./help-guides";

export const enhancementGuideSections: GuideSection[] = [
  {
    id: "fasce-multigiorno",
    title: "Scegliere più giorni e orari per le sessioni",
    text: "In Sessioni e slot il Capo Area può prendere più disponibilità aperte dall'Amministrazione in una sola operazione e decidere un intervallo diverso per ogni giornata.",
    steps: [
      "Apri Sessioni e slot e usa il riquadro Scegli giorni e orari.",
      "Seleziona area e recruitment e, se serve, filtra l'aula.",
      "Spunta le giornate che ti interessano. Ogni giornata parte con l'intero orario reso disponibile dall'Amministrazione.",
      "Per ogni giorno modifica Da e A se vuoi usare soltanto una parte della disponibilità, per esempio 11:00–13:00 il 22 e 09:00–15:00 il 23 e 24.",
      "Se vuoi tutti i giorni con tutti gli orari usa Seleziona tutte le giornate e tutti gli orari.",
      "Conferma la prenotazione delle fasce; successivamente crea le sessioni e genera gli slot con la durata desiderata.",
    ],
    warning: "Ogni intervallo deve restare dentro la disponibilità aperta dall'Amministrazione. Il database verifica anche la capacità dell'aula e rifiuta l'intera operazione se una delle fasce non è più disponibile.",
  },
  {
    id: "votazioni-area",
    title: "Votazioni dei candidati",
    text: "La sezione Votazioni permette ai Capi Area di registrare i giudizi dei ragazzi incontrati a colloquio.",
    steps: [
      "Apri Votazioni dal menu Area.",
      "Inserisci Nome, Cognome, Mail, Corso di Studi, Data del colloquio, Votazione da 1 a 30 e, se vuoi, un commento.",
      "Usa Modifica per correggere un elemento, Archivia per spostarlo nello storico ed Elimina per rimuoverlo definitivamente.",
      "Puoi ordinare l'elenco per inserimento, voto decrescente o voto crescente.",
      "Reset lista elimina definitivamente tutte le votazioni dell'area selezionata, comprese quelle archiviate.",
    ],
    warning: "Elimina e Reset sono operazioni definitive e non dispongono di ripristino.",
  },
  {
    id: "reminder-personalizzato",
    title: "Mandare un reminder personalizzato",
    text: "Il Capo Area può inviare una mail di promemoria direttamente dalla prenotazione nel Calendario.",
    steps: [
      "Apri Calendario e seleziona una prenotazione confermata.",
      "Nel riquadro Invia reminder via email scrivi il testo personalizzato da comunicare al candidato.",
      "Premi Manda reminder e conferma il destinatario.",
      "GalileoHub aggiunge automaticamente al messaggio giorno, orario, aula e area e inserisce la mail nella stessa coda usata dalle notifiche di prenotazione.",
    ],
    warning: "Il reminder manuale è disponibile ai Capi Area sulle prenotazioni che possono gestire. Il testo personalizzato è limitato a 2000 caratteri.",
  },
  {
    id: "email-responsive",
    title: "Email di conferma e notifiche",
    text: "Le email generate da GalileoHub includono una versione HTML responsive per telefono e PC e una versione testuale di compatibilità.",
    steps: [
      "La conferma mostra in modo chiaro giorno, orario, aula e area.",
      "Modifiche, annullamenti e reminder usano lo stesso formato leggibile su dispositivi diversi.",
      "Se l'appuntamento è in Aula Riunioni 5067 viene aggiunta automaticamente la nota con il punto di attesa al secondo piano del Polo A.",
      "Per comunicazioni il candidato può rispondere alla mail ricevuta.",
    ],
  },
  {
    id: "admin-recruitment-cascade",
    title: "Archiviare o eliminare un recruitment completo",
    adminOnly: true,
    text: "Recruitment consente di ripulire rapidamente tutte le viste operative relative a una campagna senza dover intervenire una sessione alla volta.",
    steps: [
      "Archivia conserva il recruitment e il relativo storico, ma toglie dai calendari operativi fasce, sessioni, slot e prenotazioni collegati e libera le capacità condivise delle aule.",
      "L'archiviazione non invia email di annullamento ai candidati.",
      "Archivia ed elimina rimuove definitivamente recruitment, fasce, sessioni, slot, prenotazioni, candidati e notifiche appartenenti a quella campagna.",
      "Aree, account, aule, disponibilità generali delle aule e link pubblici stabili delle aree non vengono eliminati.",
      "Un recruitment già archiviato può essere eliminato definitivamente dalla stessa pagina.",
    ],
    warning: "Archivia ed elimina è irreversibile. Usa Archivia se vuoi soltanto pulire i calendari mantenendo lo storico.",
  },
  {
    id: "admin-votazioni",
    title: "Consultare le Votazioni di tutte le aree",
    adminOnly: true,
    text: "Amministrazione vede le valutazioni inserite dai Capi Area, raggruppate per area, in modalità di sola lettura.",
    steps: [
      "Apri Votazioni dal menu Amministrazione.",
      "Consulta i gruppi separati per area e usa l'ordinamento per inserimento o per voto.",
      "Amministrazione non può modificare, archiviare o cancellare singole valutazioni.",
      "Reset generale elimina definitivamente tutte le votazioni di tutte le aree, comprese quelle archiviate.",
    ],
    warning: "Reset generale è l'unica operazione di modifica disponibile ad Amministrazione nella sezione Votazioni ed è irreversibile.",
  },
];
