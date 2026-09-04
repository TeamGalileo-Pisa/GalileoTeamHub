import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rpc } from "../lib/operations";
import { formatDateTime } from "../lib/dates";
interface Diagnostics {
  worker_configured: boolean;
  deliveries: Array<{
    id: string;
    kind: string;
    status: string;
    simulated: boolean;
    send_uncertain: boolean;
    attempt_count: number;
    last_error: string | null;
    created_at: string;
    next_attempt_at: string;
    sent_at: string | null;
  }>;
}
export function EmailDiagnostics() {
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["email-diagnostics"],
    queryFn: () => rpc<Diagnostics>("list_email_diagnostics"),
    refetchInterval: 30000,
  });
  const mutation = useMutation({
    mutationFn: (id: string) =>
      rpc("retry_email_delivery", { p_delivery_id: id }),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ["email-diagnostics"] });
    },
  });
  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <h2>Diagnostica email</h2>
          <p>Ultime 100 consegne · aggiornamento ogni 30 secondi</p>
        </div>
      </div>
      <div className="panel__body">
        <p>
          Worker:{" "}
          {query.data?.worker_configured
            ? "configurato (ogni minuto)"
            : "da inizializzare con Email di prova"}
        </p>
        <p className="field-help">
          Configurato non significa che Gmail sia operativo: verifica una vera
          ricezione. Dopo un errore temporaneo sono previsti tentativi a 30 s, 1
          min, 2 min, 4 min e 8 min.
        </p>
        {query.isLoading && <p>Caricamento…</p>}
        {(query.error || mutation.error) && (
          <p className="form-error" role="alert">
            {(query.error || mutation.error)?.message}
          </p>
        )}
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Creata</th>
                <th>Notifica</th>
                <th>Stato</th>
                <th>Tentativi</th>
                <th>Diagnosi</th>
                <th>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.deliveries.map((d) => (
                <tr key={d.id}>
                  <td>{formatDateTime(d.created_at)}</td>
                  <td>
                    {{
                      booking_confirmation: "Conferma",
                      booking_changed: "Modifica",
                      booking_cancelled: "Annullamento",
                      booking_reminder: "Promemoria",
                    }[d.kind] ?? d.kind}
                  </td>
                  <td>
                    {d.simulated
                      ? "Simulazione precedente · non inviata"
                      : ({
                          pending: "In coda",
                          sending: "Invio in corso",
                          sent: "Accettata da Gmail",
                          failed: "Non inviata",
                        }[d.status] ?? d.status)}
                  </td>
                  <td>{d.attempt_count}/6</td>
                  <td>
                    {d.send_uncertain
                      ? "Esito incerto: controlla la Posta inviata. I retry verificano il messaggio senza reinviarlo."
                      : d.last_error
                        ? "Verifica configurazione Gmail, autorizzazioni e quota. Codice: " +
                          d.last_error
                        : "—"}
                  </td>
                  <td>
                    {d.status === "failed" && (
                      <button
                        className="button button--secondary button--small"
                        disabled={mutation.isPending}
                        onClick={() => mutation.mutate(d.id)}
                      >
                        Riprova
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {query.data && !query.data.deliveries.length && (
          <p>Nessuna notifica in coda.</p>
        )}
      </div>
    </section>
  );
}
