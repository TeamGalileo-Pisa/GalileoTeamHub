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
