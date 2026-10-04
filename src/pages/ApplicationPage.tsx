import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { community } from "../lib/community";
import {
  applicationChoices,
  certifications,
  divisions,
  genericDivision,
} from "../lib/application-fields";
import { Brand } from "../components/Brand";
export function ApplicationPage() {
  const [areaId, setAreaId] = useState("");
  const [localError, setLocalError] = useState("");
  const areas = useQuery({
    queryKey: ["public-application-areas"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("public_application_areas");
      if (error) throw error;
      return data as { id: string; name: string; slug: string }[];
    },
  });
  const division = areaId
    ? divisions[areas.data?.find((a) => a.id === areaId)?.slug ?? ""] ??
      genericDivision
    : undefined;
  const mutation = useMutation({
    mutationFn: (form: FormData) =>
      community({
        action: "apply",
        areaId,
        firstName: form.get("firstName"),
        lastName: form.get("lastName"),
        email: form.get("email"),
        answers: {
          ...Object.fromEntries(form),
          skills: form.getAll("skills"),
          certifications: form.getAll("certifications"),
          privacyAccepted: form.get("privacyAccepted") === "on",
        },
      }),
  });
  const choice = (name: keyof typeof applicationChoices, label: string) => (
    <label className="form-field" key={name}>
      {label} *<select className="select" name={name} required defaultValue="">
        <option value="" disabled>Seleziona</option>
        {applicationChoices[name].map((v) => <option key={v}>{v}</option>)}
      </select>
    </label>
  );
  const text = (name: string, label: string, required = true) => (
    <label className="form-field form-field--full">
      {label}
      {required ? " *" : ""}
      <textarea
        className="input"
        name={name}
        required={required}
        maxLength={4000}
        rows={3}
      />
    </label>
  );
  return (
    <main
      className="page-container"
      style={{ maxWidth: 900, margin: "auto", padding: 24 }}
    >
      <Brand />
      <h1>Team Galileo Pisa · Candidature</h1>
      <p>
        Siamo un team multidisciplinare di studenti e studentesse
        dell'Università di Pisa, nato con l'obiettivo di progettare e sviluppare
        da zero un rover planetario per competere all'European Rover Challenge
        (ERC).
      </p>
      {areas.isPending ? <p>Caricamento aree…</p> : areas.error
        ? (
          <p role="alert">
            Impossibile caricare le candidature. Riprova più tardi.
          </p>
        )
        : !areas.data?.length
        ? <p>Le candidature sono attualmente chiuse.</p>
        : mutation.isSuccess
        ? (
          <div className="form-success" role="status">
            Candidatura ricevuta. Riceverai una conferma via email. La
            prenotazione del colloquio sarà confermata separatamente con data e
            ora.
          </div>
        )
        : (
          <form
            className="panel panel__body form-grid application-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const data = new FormData(form);
              if (!data.getAll("skills").length) {
                setLocalError("Seleziona almeno una competenza per l’area scelta.");
                mutation.reset();
                form.querySelector<HTMLInputElement>("input[name=skills]")?.focus();
                return;
              }
              if (!data.getAll("certifications").length) {
                setLocalError("Seleziona almeno una certificazione o l’opzione “Nessuna”.");
                mutation.reset();
                form.querySelector<HTMLInputElement>("input[name=certifications]")?.focus();
                return;
              }
              setLocalError("");
              mutation.mutate(data);
            }}
          >
            <h2 className="form-field--full">Chi sei</h2>
            {[["firstName", "Nome"], ["lastName", "Cognome"], [
              "email",
              "Email istituzionale",
            ], ["degree", "Corso di Laurea"]].map(([n, l]) => (
              <label key={n} className="form-field">
                {l} *<input
                  className="input"
                  name={n}
                  type={n === "email" ? "email" : "text"}
                  required
                  maxLength={200}
                />
              </label>
            ))}
            {choice("year", "Anno di iscrizione")}
            <label className="form-field">
              Per quale specifica Divisione ti stai candidando? *<select
                className="select"
                required
                value={areaId}
                onChange={(e) => setAreaId(e.target.value)}
              >
                <option value="">Seleziona area</option>
                {areas.data.map((a) => (
                  <option key={a.id} value={a.id}>
                    {divisions[a.slug]?.title ?? a.name}
                  </option>
                ))}
              </select>
            </label>
            {division && (
              <fieldset className="application-choice-list form-field--full" key={areaId}>
                <legend>{division.question} *</legend>
                <ol className="application-choice-list__items">
                  {division.skills.map((s) => (
                    <li key={s}>
                      <label className="application-choice-option">
                        <input type="checkbox" name="skills" value={s} /> {s}
                      </label>
                    </li>
                  ))}
                </ol>
                <input
                  className="input"
                  name="otherSkills"
                  placeholder="Altro: specifica"
                  maxLength={1000}
                />
              </fieldset>
            )}
            {choice("level", "Livello di competenza")}
            {text("motivation", "Perché sei interessato/a a questo progetto?")}
            {text(
              "expectations",
              "Perché ti stai candidando in questa fase e cosa ti aspetti da questa esperienza?",
            )}
            {choice(
              "leadership",
              "Saresti disponibile ad assumere ruoli di responsabilità o di Capo Area?",
            )}
            {choice(
              "availability",
              "Quante ore a settimana, mediamente, pensi di poter dedicare al progetto?",
            )}
            {choice(
              "presence",
              "Quanto spesso puoi garantire la presenza fisica a Pisa?",
            )}
            {text("experience", "Esperienze pregresse", false)}
            {choice(
              "deadlines",
              "Come gestisci solitamente le scadenze importanti o i momenti di picco di lavoro?",
            )}
            <fieldset className="application-choice-list form-field--full">
              <legend>Certificazioni extra o competenze linguistiche *</legend>
              <ol className="application-choice-list__items">
                {certifications.map((s) => (
                  <li key={s}>
                    <label className="application-choice-option">
                      <input type="checkbox" name="certifications" value={s} /> {s}
                    </label>
                  </li>
                ))}
              </ol>
            </fieldset>
            {choice(
              "problemSolving",
              "Di fronte a un problema tecnico o logistico senza soluzione, qual è il tuo primo istinto?",
            )}
            {text("projects", "Progetti personali", false)}
            <label className="form-field--full">
              <input type="checkbox" required name="privacyAccepted" />{" "}
              Acconsento al trattamento dei dati inseriti esclusivamente da
              parte dei promotori del Team Galileo Pisa ai fini della selezione
              e dell'organizzazione delle attività del team.
            </label>
            {(localError || mutation.error) && (
              <p role="alert" className="form-error">
                {localError || mutation.error?.message}
              </p>
            )}
            {mutation.isIdle && <p className="form-hint form-field--full">Per i gruppi con l’asterisco, seleziona almeno una risposta.</p>}
            <button
              className="button button--primary"
              disabled={mutation.isPending}
            >
              Invia candidatura
            </button>
          </form>
        )}
    </main>
  );
}

