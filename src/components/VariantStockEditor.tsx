import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { serializeVariants, splitGroup, type VariantGroup } from "../lib/merch-variants";

type Group = VariantGroup;
type Row = { key: number; group: Group; label: string; stock: string };
export type VariantSeed = { label: string; stock: number | null };

const GROUPS: Group[] = ["Uomo", "Donna"];
const CLOTHING_SIZES = ["S", "M", "L", "XL", "2XL", "3XL"];

let rowCounter = 0;
const makeRow = (group: Group, label = "", stock = ""): Row => ({ key: ++rowCounter, group, label, stock });

/**
 * Editor a righe per taglie/varianti e scorte, con la possibilità di offrire
 * il prodotto in versione uomo e donna. Il valore finale viaggia nel campo
 * nascosto `name` nello stesso formato di sempre ("Uomo M:10"), quindi
 * ordini, esportazioni e salvataggio non cambiano.
 */
export function VariantStockEditor({ name, initial }: { name: string; initial?: VariantSeed[] }) {
  const [rows, setRows] = useState<Row[]>(() =>
    (initial?.length ? initial : CLOTHING_SIZES.map((label) => ({ label, stock: null }))).map((item) => {
      const { group, label } = splitGroup(item.label);
      return makeRow(group, label, item.stock === null ? "" : String(item.stock));
    }),
  );
  const [genderMode, setGenderMode] = useState(() => rows.length > 0 && rows.every((row) => row.group !== ""));

  const update = (key: number, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const chooseMode = (gender: boolean) => {
    if (gender === genderMode) return;
    setGenderMode(gender);
    setRows((current) => {
      if (gender) {
        // Ogni taglia esiste per Uomo (con la scorta già inserita) e per Donna (da compilare).
        return [
          ...current.map((row) => makeRow("Uomo", row.label, row.stock)),
          ...current.map((row) => makeRow("Donna", row.label)),
        ];
      }
      const seen = new Set<string>();
      const merged: Row[] = [];
      for (const row of current) {
        const key = row.label.trim().toLowerCase();
        if (key && seen.has(key)) continue;
        seen.add(key);
        merged.push(makeRow("", row.label, row.stock));
      }
      return merged;
    });
  };

  const applyClothing = () =>
    setRows(
      genderMode
        ? GROUPS.flatMap((group) => CLOTHING_SIZES.map((label) => makeRow(group, label)))
        : CLOTHING_SIZES.map((label) => makeRow("", label)),
    );
  const applySingleSize = () =>
    setRows(genderMode ? GROUPS.map((group) => makeRow(group, "Unica")) : [makeRow("", "Unica")]);

  const renderGroup = (group: Group) => {
    const groupRows = rows.filter((row) => row.group === group);
    const prefix = group ? `${group} ` : "";
    return (
      <div className="variant-editor__group" key={group || "all"}>
        {group && <h4>{group}</h4>}
        {groupRows.length > 0 && (
          <div className="variant-editor__head" aria-hidden="true">
            <span>Taglia o variante</span>
            <span>Scorta</span>
            <span />
          </div>
        )}
        {groupRows.map((row, index) => (
          <div className="variant-editor__row" key={row.key}>
            <input
              className="input"
              aria-label={`Nome della variante ${prefix}${index + 1}`}
              placeholder="Es. M, Nero…"
              maxLength={50}
              value={row.label}
              onChange={(event) => update(row.key, { label: event.target.value })}
            />
            <input
              className="input"
              aria-label={`Scorta ${prefix}${row.label || index + 1}`}
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              placeholder="Illimitata"
              value={row.stock}
              onChange={(event) => update(row.key, { stock: event.target.value })}
            />
            <button
              className="icon-button"
              type="button"
              aria-label={`Rimuovi ${prefix}${row.label || `variante ${index + 1}`}`}
              onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <button
          className="button button--secondary button--small"
          type="button"
          onClick={() => setRows((current) => [...current, makeRow(group)])}
        >
          <Plus size={15} /> Aggiungi {group ? `taglia ${group.toLowerCase()}` : "variante"}
        </button>
      </div>
    );
  };

  return (
    <fieldset className="variant-editor form-field--full">
      <legend>Taglie, varianti e scorte</legend>
      <div className="variant-editor__mode" role="group" aria-label="Per chi è il prodotto">
        <button
          className="button button--secondary button--small"
          type="button"
          aria-pressed={!genderMode}
          onClick={() => chooseMode(false)}
        >
          Per tutti
        </button>
        <button
          className="button button--secondary button--small"
          type="button"
          aria-pressed={genderMode}
          onClick={() => chooseMode(true)}
        >
          Uomo e donna
        </button>
      </div>
      <p className="variant-editor__hint">
        {genderMode
          ? "Ogni taglia viene creata per Uomo e per Donna: chi ordina vedrà, ad esempio, “Uomo M” e “Donna M”. Compila la scorta di ciascuna versione. Scorta vuota = disponibilità illimitata."
          : "Lascia la scorta vuota per una disponibilità illimitata."}
      </p>
      <div className="variant-editor__presets">
        <button className="button button--secondary button--small" type="button" onClick={applyClothing}>
          Abbigliamento (S–3XL)
        </button>
        <button className="button button--secondary button--small" type="button" onClick={applySingleSize}>
          Taglia unica
        </button>
      </div>
      <div className="variant-editor__rows">
        {genderMode ? GROUPS.map((group) => renderGroup(group)) : renderGroup("")}
      </div>
      <input type="hidden" name={name} value={serializeVariants(rows)} />
    </fieldset>
  );
}
