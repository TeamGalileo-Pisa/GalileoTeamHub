import { CFU_CRITERIA, CFU_LEVELS, cfuFinalGrade, cfuScore, cfuVerdict, type CfuCriterionId, type CfuRatings } from "../lib/cfu";

/** Descrizione del lavoro svolto + matrice dei criteri. Il giudizio finale si vede solo con showResult (Team Leader). */
export function CfuEvaluationFields({
  description,
  ratings,
  onDescription,
  onRating,
  disabled = false,
  showResult = false,
}: {
  description: string;
  ratings: CfuRatings;
  onDescription: (value: string) => void;
  onRating: (criterion: CfuCriterionId, level: (typeof CFU_LEVELS)[number]["id"]) => void;
  disabled?: boolean;
  /** Solo per il Team Leader: i Capi Area non vedono punteggi né giudizio. */
  showResult?: boolean;
}) {
  const score = cfuScore(ratings);
  const verdict = cfuVerdict(score);
  return (
    <div className="cfu-fields">
      <label className="form-field">Descrizione dei compiti e delle attività svolte
        <textarea className="input" rows={6} maxLength={4000} value={description} disabled={disabled}
          placeholder="Mansioni specifiche, progetti seguiti e responsabilità assunte durante l'anno"
          onChange={(event) => onDescription(event.target.value)} />
      </label>

      <div className="data-table-wrapper">
        <table className="data-table">
          <caption className="sr-only">Matrice di valutazione</caption>
          <thead>
            <tr>
              <th scope="col">Criterio</th>
              {CFU_LEVELS.map((level) => <th scope="col" key={level.id} style={{ textAlign: "center" }}>{level.label}{showResult && <><br /><small>{level.points} pt</small></>}</th>)}
            </tr>
          </thead>
          <tbody>
            {CFU_CRITERIA.map((criterion) => (
              <tr key={criterion.id}>
                <th scope="row" style={{ fontWeight: 500, textAlign: "left" }}>{criterion.label}</th>
                {CFU_LEVELS.map((level) => (
                  <td key={level.id} style={{ textAlign: "center" }}>
                    <input type="radio" name={`cfu-${criterion.id}`} disabled={disabled}
                      aria-label={`${criterion.label}: ${level.label}`}
                      checked={ratings[criterion.id] === level.id}
                      onChange={() => onRating(criterion.id, level.id)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showResult && (
        <p role="status" style={{ marginTop: 12 }}>
          <strong>{verdict === "favorevole" ? "FAVOREVOLE" : "CONTRARIO"}</strong>{" "}
          <span className="table-secondary">— valutazione finale di {cfuFinalGrade(score)}</span>
        </p>
      )}
    </div>
  );
}
