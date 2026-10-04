import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { membershipAreas, membershipCommitments, membershipLeadershipRoles, normalizeMembershipAnswers, type MembershipAnswers } from "../lib/membership-form";

type LoadedDraft = { answers?: MembershipAnswers; submitted?: boolean };

type Props = {
  loadDraft: () => Promise<LoadedDraft>;
  saveDraft: (answers: MembershipAnswers) => Promise<unknown>;
  submit: (answers: MembershipAnswers) => Promise<unknown>;
  onNewDraft?: () => void;
  onDone?: () => void;
};

export function MembershipQuestionnaire({ loadDraft, saveDraft, submit, onNewDraft, onDone }: Props) {
  const [answers, setAnswers] = useState<MembershipAnswers>({});
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<MembershipAnswers>({});
  const timer = useRef<number | undefined>(undefined);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    void loadDraft().then((draft) => {
      if (!active) return;
      const normalized = normalizeMembershipAnswers(draft.answers);
      latest.current = normalized;
      setAnswers(normalized);
      setSubmitted(draft.submitted === true);
    }).catch((reason: unknown) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : "Impossibile caricare la bozza.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
      if (timer.current !== undefined) window.clearTimeout(timer.current);
    };
  }, [loadDraft]);

  const persist = (snapshot: MembershipAnswers) => {
    setSaveStatus("saving");
    saveQueue.current = saveQueue.current.catch(() => undefined).then(async () => {
      await saveDraft(snapshot);
      setSaveStatus("saved");
    }).catch(() => setSaveStatus("failed"));
    return saveQueue.current;
  };

  const queueSave = (snapshot: MembershipAnswers) => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      void persist(snapshot);
    }, 500);
  };

  const change = (event: ChangeEvent<HTMLFormElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    const { name, type, value } = target;
    const checked = type === "checkbox" ? (target as HTMLInputElement).checked : false;
    const next: MembershipAnswers = {
      ...latest.current,
      [name]: type === "checkbox" ? (checked ? "yes" : "") : value,
    };
    if (name === "area" && value !== "Direzione tecnica/Responsabile") next.leadershipRole = "";
    latest.current = next;
    setAnswers(next);
    setError(null);
    queueSave(next);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
    setSubmitting(true);
    setError(null);
    await persist(latest.current);
    try {
      await submit(latest.current);
      setSubmitted(true);
      onDone?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Invio non riuscito.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <p role="status">Caricamento della bozza…</p>;
  if (error && saveStatus === "idle" && Object.keys(answers).length === 0) {
    return <p role="alert" className="form-error">{error}</p>;
  }
  if (submitted) return <section className="panel panel__body">
    <h2>Modulo inviato</h2>
    <p>Controlla la tua casella email. Stampa il PDF, firmalo e consegnalo al Team Leader.</p>
    {onNewDraft && <button className="button button--secondary" type="button" onClick={onNewDraft}>Compila un altro modulo</button>}
  </section>;

  const checked = (key: keyof MembershipAnswers) => answers[key] === "yes";
  return <form className="panel panel__body form-grid" onSubmit={handleSubmit} onChange={change}>
    <p className="form-field--full">* Obbligatoria. Le risposte vengono salvate automaticamente mentre compili.</p>
    <label className="form-field">1. Nome *<input className="input" name="firstName" required maxLength={100} value={answers.firstName ?? ""} /></label>
    <label className="form-field">2. Cognome *<input className="input" name="lastName" required maxLength={100} value={answers.lastName ?? ""} /></label>
    <label className="form-field--full">3. Corso di Laurea (inserire il nome completo) *<input className="input" name="degree" required maxLength={180} value={answers.degree ?? ""} /></label>
    <label className="form-field--full">4. Dipartimento di afferenza del Corso di Laurea (inserire il nome completo) *<input className="input" name="department" required maxLength={180} value={answers.department ?? ""} /></label>
    <label className="form-field">5. Matricola *<input className="input" name="studentNumber" required maxLength={30} value={answers.studentNumber ?? ""} /></label>

    <fieldset className="form-field--full">
      <legend>6. Divisione/Area di appartenenza *</legend>
      {membershipAreas.map((area) => <label className="form-field" key={area}>
        <input type="radio" name="area" value={area} checked={answers.area === area} required /> {area}
      </label>)}
    </fieldset>

    {answers.area === "Direzione tecnica/Responsabile" && <fieldset className="form-field--full">
      <legend>Direzione tecnica — 7. Direzione di Area *</legend>
      {membershipLeadershipRoles.map((role) => <label className="form-field" key={role}>
        <input type="radio" name="leadershipRole" value={role} checked={answers.leadershipRole === role} required /> {role}
      </label>)}
    </fieldset>}

    <fieldset className="form-field--full">
      <legend>8. In tale sede si impegna a: *</legend>
      <ol>{membershipCommitments.map((commitment) => <li key={commitment}>{commitment}</li>)}</ol>
      <label><input type="checkbox" name="commitmentsAccepted" value="yes" checked={checked("commitmentsAccepted")} required /> Accetto</label>
    </fieldset>

    <fieldset className="form-field--full">
      <legend>9. Accettazione del Regolamento Interno *</legend>
      <p>Dichiara di aver preso visione del Regolamento Interno del Team Galileo e di accettarne integralmente ogni disposizione, compresi i criteri di merito per la permanenza e le relative procedure di decadenza.</p>
      <label><input type="checkbox" name="internalRegulationAccepted" value="yes" checked={checked("internalRegulationAccepted")} required /> Accetto</label>
    </fieldset>

    <fieldset className="form-field--full">
      <legend>10. Proprietà intellettuale e responsabilità *</legend>
      <p>Riconosce che ogni prodotto dell'ingegno, codice, modello o dato sviluppato nell'ambito del Team è di esclusiva proprietà dell'Università di Pisa. Solleva il Team, l'Ateneo e il Faculty Advisor da qualsiasi responsabilità civile o penale derivante da proprie condotte improprie o violazioni dei protocolli.</p>
      <label><input type="checkbox" name="ipAccepted" value="yes" checked={checked("ipAccepted")} required /> Accetto</label>
    </fieldset>

    <fieldset className="form-field--full">
      <legend>11. Autocertificazione requisiti *</legend>
      <p>Consapevole delle sanzioni previste per dichiarazioni mendaci, dichiara sotto la propria responsabilità:</p>
      <ol>
        <li>di essere regolarmente iscritto/a presso l'Università di Pisa al Corso di Laurea sopra indicato;</li>
        <li>di essere in possesso dei requisiti di carriera accademica (CFU) richiesti per l'accesso e la permanenza nel Team;</li>
        <li>di possedere una competenza linguistica in inglese pari almeno al livello B2;</li>
        <li>di non trovarsi in situazioni di conflitto di interesse con gli scopi istituzionali del Team.</li>
      </ol>
      <label><input type="checkbox" name="selfCertificationAccepted" value="yes" checked={checked("selfCertificationAccepted")} required /> Confermo</label>
    </fieldset>

    <fieldset className="form-field--full">
      <legend>12. Trattamento dei dati personali *</legend>
      <p>Acconsento al trattamento dei dati personali da parte del Team Galileo Pisa per la gestione amministrativa della mia adesione e l'organizzazione delle attività del team, secondo l'informativa privacy.</p>
      <label><input type="checkbox" name="gdprAccepted" value="yes" checked={checked("gdprAccepted")} required /> Acconsento al trattamento dei dati personali</label>
    </fieldset>

    <fieldset className="form-field--full">
      <legend>Consenso facoltativo per immagini e video</legend>
      <p>Acconsento facoltativamente all'uso di immagini e video che mi ritraggono, realizzati durante le attività ufficiali del Team Galileo, per comunicazioni e contenuti promozionali del team. Posso non prestare o revocare questo consenso senza che ciò impedisca l'adesione.</p>
      <label><input type="checkbox" name="mediaAccepted" value="yes" checked={checked("mediaAccepted")} /> Acconsento all'uso di immagini e video</label>
    </fieldset>

    <label className="form-field--full">13. Email istituzionale (xxx@studenti.unipi.it) *<input className="input" name="institutionalEmail" type="email" required maxLength={254} pattern=".+@studenti\.unipi\.it" title="Inserisci l'indirizzo @studenti.unipi.it" value={answers.institutionalEmail ?? ""} /></label>
    <label className="form-field">14. Numero di cellulare *<input className="input" name="phone" type="tel" required maxLength={40} value={answers.phone ?? ""} /></label>
    <label className="form-field--full">15. LinkedIn — link al profilo personale<input className="input" name="linkedin" type="url" maxLength={500} value={answers.linkedin ?? ""} /></label>
    <fieldset className="form-field--full">
      <legend>Consenso per la Privacy — 16. *</legend>
      <p>Accetti che i dati inseriti in questo modulo vengano trattati esclusivamente dalla Direzione del Team Galileo Pisa a fini amministrativi e dell'organizzazione delle attività del team?</p>
      <label><input type="checkbox" name="privacyAccepted" value="yes" checked={checked("privacyAccepted")} required /> Accetto</label>
    </fieldset>

    <p role="status" className="form-field--full">{saveStatus === "saving" ? "Salvataggio della bozza…" : saveStatus === "saved" ? "Bozza salvata" : saveStatus === "failed" ? "Salvataggio non riuscito: modifica un campo per riprovare." : ""}</p>
    {error && <p role="alert" className="form-error">{error}</p>}
    <button className="button button--primary" type="submit" disabled={submitting}>{submitting ? "Invio…" : "Invia il modulo e ricevi il PDF"}</button>
  </form>;
}
