import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

type Row = { key: number; label: string; stock: string };
export type VariantSeed = { label: string; stock: number | null };

let rowCounter = 0;
const makeRow = (label = "", stock = ""): Row => ({ key: ++rowCounter, label, stock });

const CLOTHING_SIZES = ["S", "M", "L", "XL", "2XL", "3XL"];

/** Serializza nel formato riga "taglia:quantità" già letto da parseStock(). */
export function serializeVariants(rows: { label: string; stock: string }[]): string {
  return rows
    .map((row) => ({ label: row.label.replace(/[:\r\n]/g, " ").trim(), stock: row.stock.trim() }))
    .filter((row) => row.label)
    .map((row) => `${row.label}:${row.stock}`)
    .join("\n");
}

/**
 * Editor a righe per taglie/varianti e scorte. Sostituisce la casella di testo
 * in cui bisognava digitare a mano "S:10". Il valore finale viaggia nel campo
 * nascosto `name`, quindi il salvataggio resta identico.
 */
export function VariantStockEditor({ name, initial }: { name: string; initial?: VariantSeed[] }) {
  const [rows, setRows] = useState<Row[]>(() =>
    (initial?.length ? initial : CLOTHING_SIZES.map((label) => ({ label, stock: null }))).map((item) =>
      makeRow(item.label, item.stock === null ? "" : String(item.stock)),
    ),
  );

  const update = (key: number, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  return (
    <fieldset className="variant-editor form-field--full">
      <legend>Taglie, varianti e scorte</legend>
      <p className="variant-editor__hint">
        Lascia la scorta vuota per una disponibilità illimitata.
      </p>
      <div className="variant-editor__presets">
        <button
          className="button button--secondary button--small"
          type="button"
          onClick={() => setRows(CLOTHING_SIZES.map((label) => makeRow(label)))}
        >
          Abbigliamento (S–3XL)
        </button>
        <button
          className="button button--secondary button--small"
          type="button"
          onClick={() => setRows([makeRow("Taglia unica")])}
        >
          Taglia unica
        </button>
      </div>
      <div className="variant-editor__rows">
        {rows.length > 0 && (
          <div className="variant-editor__head" aria-hidden="true">
            <span>Taglia o variante</span>
            <span>Scorta</span>
            <span />
          </div>
        )}
        {rows.map((row, index) => (
          <div className="variant-editor__row" key={row.key}>
            <input
              className="input"
              aria-label={`Nome della variante ${index + 1}`}
              placeholder="Es. M, Nero…"
              maxLength={60}
              value={row.label}
              onChange={(event) => update(row.key, { label: event.target.value })}
            />
            <input
              className="input"
              aria-label={`Scorta della variante ${row.label || index + 1}`}
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
              aria-label={`Rimuovi ${row.label || `variante ${index + 1}`}`}
              onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      <button
        className="button button--secondary button--small"
        type="button"
        onClick={() => setRows((current) => [...current, makeRow()])}
      >
        <Plus size={15} /> Aggiungi variante
      </button>
      <input type="hidden" name={name} value={serializeVariants(rows)} />
    </fieldset>
  );
}
