import { useMutation } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../hooks/useAuth";
import { community } from "../lib/community";

export function MemberAdhesionPage() {
  const { access } = useAuth();
  const mutation = useMutation({
    mutationFn: (form: FormData) => community({
      action: "submit_member_adhesion",
      data: Object.fromEntries(form),
    }),
  });
  return <div className="page-container">
    <PageHeader title="Modulo di adesione" eyebrow="Area membri" description="Compila i tuoi dati personali. Il modulo PDF verrà generato con la disposizione ufficiale e inviato alla tua email." />
    <p className="muted">Area di riferimento: {access?.areas.map((a) => a.name).join(", ")}</p>
    {mutation.isSuccess ? <section className="panel panel__body"><h2>Modulo inviato</h2><p>Controlla la tua casella email. Stampa il PDF, firmalo e consegnalo al Team Leader.</p><button className="button button--secondary" onClick={() => mutation.reset()}>Compila un altro modulo</button></section> :
    <form className="panel panel__body form-grid" onSubmit={(event) => { event.preventDefault(); mutation.mutate(new FormData(event.currentTarget)); }}>
      {[["firstName","Nome","text"],["lastName","Cognome","text"],["studentNumber","Matricola","text"],["degree","Corso di Laurea","text"],["department","Dipartimento","text"],["email","Email personale","email"]].map(([name,label,type]) => <label className="form-field" key={name}>{label}<input className="input" name={name} type={type} required maxLength={name === "email" ? 254 : 180} /></label>)}
      <label className="form-field--full"><input type="checkbox" name="confirmed" value="yes" required /> Confermo che i dati sono corretti e autorizzo l'invio del modulo all'indirizzo indicato.</label>
      {mutation.error && <p role="alert" className="form-error">{mutation.error.message}</p>}
      <button className="button button--primary" disabled={mutation.isPending}>{mutation.isPending ? "Invio…" : "Genera e invia il PDF"}</button>
    </form>}
  </div>;
}

