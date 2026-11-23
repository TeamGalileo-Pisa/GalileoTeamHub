import { Printer } from "lucide-react";
import { PageHeader } from "../components/PageHeader";

const LEVELS = ["Ottimo", "Discreto", "Buono", "Sufficiente", "Insufficiente"] as const;

// Criterio -> indice del livello segnato (0 = Ottimo ... 4 = Insufficiente), come nel modulo LaTeX.
const MATRIX: { criterio: string; scelta: number }[] = [
  { criterio: "Competenza e rigore tecnico-scientifico/analitico", scelta: 2 },
  { criterio: "Autonomia operativa e rispetto delle scadenze", scelta: 2 },
  { criterio: "Problem solving e gestione degli imprevisti", scelta: 0 },
  { criterio: "Costanza, presenza e gestione del tempo", scelta: 4 },
  { criterio: "Capacità di lavoro in team multidisciplinare", scelta: 4 },
  { criterio: "Comunicazione, proattività e spirito d'iniziativa", scelta: 1 },
  { criterio: "Rispetto delle norme di sicurezza e regolamenti", scelta: 0 },
  { criterio: "Qualità della documentazione e dei report", scelta: 4 },
];

const Line = ({ w = "7cm" }: { w?: string }) => (
  <span style={{ display: "inline-block", width: w, borderBottom: "1px solid currentColor", verticalAlign: "bottom" }} />
);
const Box = ({ checked = false }: { checked?: boolean }) => (
  <span aria-label={checked ? "selezionato" : "non selezionato"} style={{ fontWeight: checked ? 700 : 400 }}>
    {checked ? "☒" : "☐"}
  </span>
);

export function CfuPage() {
  const today = new Date().toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="page-container">
      <PageHeader
        title="CFU"
        eyebrow="Riconoscimento CFU"
        description="Scheda di valutazione ai fini del riconoscimento CFU per l'attività nel Team Galileo."
        actions={
          <button className="button button--primary" type="button" onClick={() => window.print()}>
            <Printer size={17} /> Stampa
          </button>
        }
      />

      <article className="panel panel__body" style={{ maxWidth: 820, lineHeight: 1.6 }}>
        <header style={{ textAlign: "center", marginBottom: 16 }}>
          <img src="/Logo Verticale Blu.png" alt="Team Galileo" style={{ width: "5cm", maxWidth: "50%" }} onError={(e) => (e.currentTarget.style.display = "none")} />
          <h2 style={{ margin: "8px 0 0" }}>SCHEDA DI VALUTAZIONE</h2>
          <p style={{ margin: 0 }}><strong>Ai fini del Riconoscimento CFU — Attività all'interno del Team Galileo</strong></p>
          <p style={{ margin: 0 }}><em>[1247I] — Laboratorio di Automazione e Robotica</em></p>
        </header>

        <p style={{ fontSize: "0.85em" }}>
          <em>
            Nota esplicativa: La presente scheda viene compilata dal Team Leader e trasmessa alla Commissione d'Esame prima della prova.
            Il giudizio espresso si riferisce esclusivamente all'attività, all'impegno e alle competenze dimostrate dal candidato nello
            svolgimento dei compiti assegnati all'interno del Team Galileo durante l'Anno Accademico, restando esclusa la valutazione
            dell'elaborato di progetto specifico di competenza del CdL.
          </em>
        </p>

        <section>
          <h3>1. DATI ANAGRAFICI E INQUADRAMENTO NEL TEAM</h3>
          <p><strong>Cognome e Nome:</strong> <Line /></p>
          <p><strong>Matricola:</strong> <Line w="3.5cm" /> <strong>Corso di Studi:</strong> <Line w="5.5cm" /></p>
          <p><strong>Dipartimento / Area:</strong> <Line w="5cm" /></p>
          <p><strong>Divisione / Settore di appartenenza:</strong> <Line w="4.5cm" /></p>
          <p><strong>Ruolo ricoperto nel Team:</strong> <Line w="5cm" /></p>
          <p><strong>Periodo di attività valutato:</strong> Da <Line w="2.5cm" /> a <Line w="2.5cm" /></p>
        </section>

        <section>
          <h3>2. PARERE VINCOLANTE DEI RESPONSABILI</h3>
          <p>Il presente modulo viene compilato d'intesa con il Direttore Tecnico e Responsabile d'Area di riferimento.</p>
          <p>
            <strong>Parere del Responsabile di Divisione:</strong> <Box checked /> Favorevole &nbsp;&nbsp;&nbsp; <Box /> Contrario
          </p>
        </section>

        <section>
          <h3>3. DESCRIZIONE DETTAGLIATA DEI COMPITI E DELLE ATTIVITÀ SVOLTE</h3>
          <p>
            <em>(Indicare le mansioni specifiche, i progetti seguiti e le responsabilità assunte dal membro all'interno della propria divisione durante l'anno)</em>
          </p>
          <div style={{ minHeight: "4cm" }} />
        </section>

        <section style={{ breakBefore: "page" }}>
          <h3>4. MATRICE DI VALUTAZIONE TRASVERSALE DELLE COMPETENZE NEL TEAM</h3>
          <p><em>Indicare con una crocetta (×) il livello di giudizio assegnato per ciascun criterio:</em></p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", borderTop: "2px solid currentColor", borderBottom: "2px solid currentColor", fontSize: "0.9em" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid currentColor" }}>
                  <th style={{ textAlign: "left", padding: "6px 4px" }}>Criterio di Valutazione</th>
                  {LEVELS.map((level) => <th key={level} style={{ padding: "6px 4px" }}>{level}</th>)}
                </tr>
              </thead>
              <tbody>
                {MATRIX.map((row) => (
                  <tr key={row.criterio}>
                    <td style={{ padding: "8px 4px" }}>{row.criterio}</td>
                    {LEVELS.map((level, index) => (
                      <td key={level} style={{ textAlign: "center" }}><Box checked={row.scelta === index} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3>5. GIUDIZIO SINTETICO E PROPOSTA AL CORSO DI LAUREA</h3>
          <p>Il sottoscritto Team Leader, visti i risultati conseguiti nell'ambito delle attività associative, esprime parere:</p>
          <p><Box /> <strong>FAVOREVOLE</strong> al riconoscimento dei CFU per l'attività svolta nel Team.</p>
          <p><Box /> <strong>CONTRARIO</strong> al riconoscimento dei CFU.</p>
          <p><strong>Eventuali note o commenti descrittivi sull'operato:</strong></p>
          <p><Line w="100%" /></p>
          <p><Line w="100%" /></p>
          <p style={{ marginTop: 24 }}>Pisa, li {today}</p>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 32 }}>
            <div style={{ textAlign: "center", width: "45%" }}>
              <div style={{ borderTop: "1px solid currentColor", width: "5.5cm", margin: "0 auto" }} />
              <small>Team Leader</small>
            </div>
          </div>
        </section>
      </article>
    </div>
  );
}
