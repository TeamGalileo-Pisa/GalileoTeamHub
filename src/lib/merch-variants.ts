export type VariantGroup = "" | "Uomo" | "Donna";

/** "Uomo M" -> { group: "Uomo", label: "M" }. Le varianti senza prefisso restano senza gruppo. */
export function splitGroup(label: string): { group: VariantGroup; label: string } {
  const match = /^(uomo|donna)\s+(.+)$/i.exec(label.trim());
  if (!match) return { group: "", label };
  return { group: match[1].toLowerCase() === "uomo" ? "Uomo" : "Donna", label: match[2] };
}

/** Serializza nel formato riga "taglia:quantità" già letto da parseStock(). */
export function serializeVariants(rows: { group?: string; label: string; stock: string }[]): string {
  return rows
    .filter((row) => row.label.trim())
    .map((row) => {
      const full = `${row.group ? `${row.group} ` : ""}${row.label}`.replace(/[:\r\n]/g, " ").replace(/\s+/g, " ").trim();
      return `${full}:${row.stock.trim()}`;
    })
    .join("\n");
}
