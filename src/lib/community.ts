import { supabase } from "./supabase";
export async function community<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("community", {
    body,
  });
  if (error) {
    let message = "Operazione non riuscita. Riprova tra poco.";
    if (error.context instanceof Response) {
      const result = await error.context.json().catch(() => ({}));
      const messages: Record<string, string> = {
        APPLICATION_CLOSED: "Le candidature per questa area sono chiuse.",
        INVALID_INVITATION: "Il link di adesione è scaduto o non è valido.",
        ALREADY_SUBMITTED: "Questo modulo è già stato inviato.",
        DUPLICATE_MEMBERSHIP: "Esiste già un modulo inviato con questa email istituzionale.",
        FORM_NOT_READY: "Il link al modulo non è ancora stato attivato dal Team Leader.",
        DUPLICATE_APPLICATION:
          "Hai già inviato una candidatura per questa area.",
        INVALID_DATA: "Completa tutti i campi obbligatori.",
        INVALID_EMAIL: "Inserisci un indirizzo email istituzionale @studenti.unipi.it valido.",
        REQUIRED_FIELDS: "Controlla nome, cognome, corso di laurea, motivazione e aspettative: uno di questi campi è vuoto.",
        PRIVACY_REQUIRED: "Per inviare la candidatura devi accettare l’informativa privacy.",
        INVALID_CHOICE: "Seleziona una risposta valida in tutti i menu a discesa.",
        INVALID_AREA: "L’area scelta non è più disponibile. Aggiorna la pagina e riprova.",
        SKILLS_REQUIRED: "Seleziona almeno una competenza per l’area scelta.",
        INVALID_SKILLS: "Una competenza selezionata non è più valida. Aggiorna la pagina e riprova.",
        CERTIFICATIONS_REQUIRED: "Seleziona almeno una certificazione oppure “Nessuna”.",
        INVALID_CERTIFICATIONS: "Una certificazione selezionata non è più valida. Aggiorna la pagina e riprova.",
        FORBIDDEN: "Non hai i permessi necessari.",
        NOT_FOUND: "La candidatura non è più disponibile.",
        UNAUTHORIZED: "Accedi nuovamente.",
        EMAIL_NOT_CONFIGURED: "Invio email non configurato sul server.",
      };
      message = messages[result.error] ?? message;
    }
    throw new Error(message);
  }
  return data as T;
}

