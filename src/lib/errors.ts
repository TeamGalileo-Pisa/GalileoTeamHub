const ERROR_MESSAGES: Array<[string, string]> = [
  ["PRIVACY_CONSENT_REQUIRED", "Per confermare la prenotazione devi leggere e accettare l'informativa privacy."],
  ["PRIVACY_VERSION_OUTDATED", "L'informativa privacy è stata aggiornata. Rileggila e conferma nuovamente l'accettazione."],
  ["PRIVACY_NOT_CONFIGURED", "L'informativa privacy non è configurata. Contatta Amministrazione."],
  ["INVALID_LEGAL_DOCUMENT", "Controlla titolo e testo del documento prima di salvarlo."],
  ["LEGAL_DOCUMENT_NOT_FOUND", "Il documento richiesto non è disponibile."],
  ["AVAILABILITY_NOT_FOUND", "La disponibilità non esiste oppure è già stata eliminata."],
  ["FORBIDDEN_OR_NOT_FOUND", "L'elemento non esiste oppure non hai i permessi per gestirlo."],
  [
    "INVALID_STUDENT_EMAIL",
    "Utilizza la tua email universitaria @studenti.unipi.it.",
  ],
  ["INVALID_SLOT", "Seleziona prima uno degli orari disponibili."],
  ["LAST_ACTIVE_ADMIN", "Deve rimanere almeno un amministratore attivo."],
  [
    "ACCOUNT_BUSY",
    "È già in corso un’operazione su questo account. Attendi qualche secondo e riprova.",
  ],
  [
    "INVALID_STAFF_DATA",
    "Controlla username, nome visualizzato, ruolo e area dell’account.",
  ],
  [
    "HAS_HISTORY",
    "Questo elemento ha uno storico: usa Annulla per conservarlo oppure Annulla ed elimina se vuoi rimuoverlo definitivamente.",
  ],
  [
    "CAMPAIGN_DATES_CONFLICT",
    "Le nuove date escluderebbero fasce o appuntamenti esistenti.",
  ],
  [
    "SLOT_HAS_BOOKINGS",
    "Questo slot ha una prenotazione confermata: gestisci prima l'appuntamento dal Calendario.",
  ],
  [
    "SLOT_OUTSIDE_ALLOCATION",
    "L’orario deve rimanere dentro la fascia assegnata.",
  ],
  [
    "INVALID_DAILY_PERIOD",
    "Controlla date, giorni della settimana e orario giornaliero (massimo un anno).",
  ],
  [
    "PASSWORD_CHANGE_REQUIRED",
    "Cambia la password iniziale prima di continuare.",
  ],
  [
    "ACCOUNT_UPDATE_FAILED",
    "Aggiornamento non completato. Riprova o contatta Amministrazione.",
  ],
  [
    "DEFAULT_PASSWORD_NOT_CONFIGURED",
    "Amministrazione deve configurare il suffisso di reset nei secret server.",
  ],
  ["23P01", "Questa fascia si sovrappone a un’altra già presente."],
  ["23505", "Esiste già un elemento con questi dati."],
  [
    "23503",
    "Questo elemento ha uno storico collegato. Usa le funzioni di annullamento o eliminazione previste dal gestionale.",
  ],
  [
    "ROOM_CAPACITY_BELOW_USAGE",
    "Non puoi impostare questa capacità perché nella finestra risultano già più colloqui contemporanei.",
  ],
  [
    "ROOM_CAPACITY_EXCEEDED",
    "L'aula ha già raggiunto il numero massimo di colloqui contemporanei in questa fascia.",
  ],
  [
    "ROOM_PHYSICAL_LIMIT_EXCEEDED",
    "La capacità della finestra supera il limite fisico configurato per l'aula.",
  ],
  [
    "ROOM_LIMIT_BELOW_ACTIVE_WINDOW_CAPACITY",
    "Il limite fisico non può essere inferiore alla capacità di una disponibilità attiva.",
  ],
  ["ROOM_NOT_ACTIVE", "L'aula selezionata non è attiva."],
  [
    "AVAILABILITY_TIME_EXCLUDES_ALLOCATIONS",
    "I nuovi orari escluderebbero una fascia già assegnata. Mantieni tutte le assegnazioni dentro la disponibilità.",
  ],
  [
    "ALLOCATION_OUTSIDE_AVAILABILITY",
    "La fascia scelta deve rientrare interamente nella disponibilità dell'aula.",
  ],
  ["AVAILABILITY_NOT_ACTIVE", "Questa disponibilità non è più attiva."],
  [
    "AVAILABILITY_HAS_BOOKINGS",
    "La disponibilità contiene colloqui prenotati. Per conservarne lo storico non può essere annullata; usa l'eliminazione definitiva solo se intendi rimuovere tutto il contenuto collegato.",
  ],
  [
    "INVALID_TIME_RANGE",
    "Controlla che l'orario finale sia successivo a quello iniziale.",
  ],
  ["INVALID_ROOM_CAPACITY", "Inserisci una capacità compresa tra 1 e 100."],
  [
    "SLOT_UNAVAILABLE",
    "Questo slot è appena stato prenotato. Scegline un altro.",
  ],
  ["INVALID_BOOKING_LINK", "Il link non è valido oppure è scaduto."],
  [
    "SESSION_ALREADY_HAS_SLOTS",
    "Questa sessione ha già degli slot disponibili.",
  ],
  ["SESSION_NOT_ACTIVE", "La sessione non è attiva."],
  [
    "ALLOCATION_TOO_SHORT",
    "La fascia è troppo breve per la durata degli slot scelta.",
  ],
  [
    "INVALID_SLOT_DURATION",
    "La durata degli slot deve essere compresa tra 5 e 180 minuti.",
  ],
  [
    "CAMPAIGN_AREA_NOT_ACTIVE",
    "La campagna o l'area selezionata non è attiva.",
  ],
  ["INVALID_EMAIL", "Inserisci un indirizzo email valido."],
  ["INVALID_CANDIDATE_NAME", "Controlla nome e cognome del candidato."],
  [
    "INVALID_ANNOUNCEMENT_TARGETS",
    "Seleziona almeno un'area destinataria valida.",
  ],
  [
    "INVALID_ANNOUNCEMENT_EXPIRY",
    "La scadenza deve essere successiva alla pubblicazione.",
  ],
  ["INVALID_ANNOUNCEMENT", "Controlla titolo e testo della comunicazione."],
  [
    "ANNOUNCEMENT_NOT_FOUND",
    "La comunicazione non esiste oppure non è più disponibile.",
  ],
  ["FORBIDDEN", "Non hai i permessi per eseguire questa operazione."],
  ["UNAUTHORIZED", "La sessione è scaduta. Accedi di nuovo."],
  [
    "ACCOUNT_CREATION_FAILED",
    "Non è stato possibile creare l'account. Verifica che non esista già.",
  ],
  [
    "ROLE_ASSIGNMENT_FAILED",
    "L'account non è stato creato perché non è stato possibile assegnare il ruolo.",
  ],
  [
    "EMAIL_NOT_CONFIGURED",
    "L'invio Gmail non è ancora configurato dall'Amministrazione.",
  ],
  ["TEST_EMAIL_FAILED", "Non è stato possibile inviare l'email di prova."],
];

function technicalMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return [
      record.error,
      record.code,
      record.message,
      record.details,
      record.hint,
    ]
      .filter((value): value is string => typeof value === "string")
      .join(" ");
  }
  return "";
}

export function toItalianErrorMessage(error: unknown): string {
  const message = technicalMessage(error);
  const match = ERROR_MESSAGES.find(([code]) => message.includes(code));
  return (
    match?.[1] ??
    "Operazione non riuscita. Riprova tra poco; se il problema continua contatta Amministrazione."
  );
}

export function friendlyError(error: unknown): Error {
  return new Error(toItalianErrorMessage(error));
}
