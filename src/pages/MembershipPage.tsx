import { useMutation } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { community } from "../lib/community";
import { Brand } from "../components/Brand";
export function MembershipPage() {
  const { token } = useParams();
  const mutation = useMutation({
    mutationFn: (data: FormData) =>
      community({
        action: "submit_membership",
        token,
        data: Object.fromEntries(data),
      }),
  });
  return (
    <main
      className="page-container"
      style={{ maxWidth: 800, margin: "auto", padding: 24 }}
    >
      <Brand />
      <h1>Modulo di adesione al Team</h1>
      <p>
        Inserisci i dati per ricevere il PDF di adesione da stampare, firmare e
        consegnare. L'area è quella assegnata dal Team Leader.
      </p>
      {mutation.isSuccess
        ? (
          <p className="form-success">
            Dati ricevuti. Il PDF verrà inviato all'indirizzo email dell'invito.
          </p>
        )
        : (
          <form
            className="panel panel__body form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate(new FormData(e.currentTarget));
            }}
          >
            {[
              ["firstName", "Nome"],
              ["lastName", "Cognome"],
              ["studentNumber", "Matricola"],
              ["degree", "Corso di Laurea"],
              ["department", "Dipartimento"],
            ].map(([n, l]) => (
              <label className="form-field" key={n}>
                {l}
                <input className="input" name={n} required maxLength={180} />
              </label>
            ))}
            <label className="form-field--full">
              <input type="checkbox" name="confirmed" value="yes" required />
              {" "}
              Confermo la correttezza dei dati e richiedo la generazione del
              modulo da esaminare e firmare.
            </label>
            {mutation.error && (
              <p role="alert" className="form-error">
                {mutation.error.message}
              </p>
            )}
            <button
              className="button button--primary"
              disabled={mutation.isPending}
            >
              Genera e invia il PDF
            </button>
          </form>
        )}
    </main>
  );
}
