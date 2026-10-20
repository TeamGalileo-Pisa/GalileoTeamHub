/** Modello del magazzino (fogli Inventario, Tecnico, Analisi, Posizioni, Movimenti, Acquisti). */

export type Area = "tecnica" | "analisi";

export interface Warehouse { id: string; name: string; location: string; notes: string; archived_at: string | null }
export interface InventoryLocation {
  id: string; warehouse_id: string; code: string; shelf_label: string; level_label: string; box_label: string;
  main_content: string; notes: string; archived_at: string | null;
}
export interface InventoryItem {
  id: string; warehouse_id: string; location_id: string | null; area: Area; subteam: string; sku: string; name: string;
  category: string; description: string; unit: string; quantity: number; minimum_quantity: number; on_loan: number;
  owner_name: string; project_use: string; supplier: string; unit_cost: number | null; total_value: number | null;
  purchase_date: string | null; expiry_date: string | null; notes: string; tech_specs: string; status: string;
  archived_at: string | null; updated_at: string;
}
export interface InventoryEvent {
  id: number; warehouse_id: string | null; item_id: string | null; warehouse_name_snapshot: string; item_name_snapshot: string;
  sku_snapshot: string; event_type: string; quantity_delta: number; quantity_before: number | null; quantity_after: number | null;
  actor_name: string; taken_by_name: string; reason: string; notes: string; movement_date: string;
  from_location_code: string; to_location_code: string; details: Record<string, unknown>; created_at: string;
}
export interface PurchaseRequest {
  id: string; code: string; request_date: string; material: string; area: Area; quantity: number; priority: string;
  requester_user_id: string | null; requester_name: string; reason: string; supplier: string; estimated_cost: number | null;
  status: string; order_date: string | null; received_date: string | null; notes: string; item_id: string | null; created_at: string;
}
export interface InventorySettings { shelf_max_letter: string; level_max: number; slot_letters: string; slot_max: number }

/** Liste di supporto (foglio "Liste"): non modificare senza autorizzazione. */
export const AREA_LABELS: Record<Area, string> = { tecnica: "Tecnica", analisi: "Analisi" };
export const SUBTEAMS: Record<Area, string[]> = {
  tecnica: ["Meccanica", "Elettronica", "Motore", "Braccio", "Sensoristica", "Generale"],
  analisi: ["Biologia", "Geologia", "Generale"],
};
export const ITEM_STATUSES: Record<Area, string[]> = {
  tecnica: ["Disponibile", "In uso", "Prestato", "Da riparare", "Danneggiato", "Smaltito"],
  analisi: ["Disponibile", "Esaurito", "Da controllare", "Smaltito"],
};
export const UNITS = ["pz", "m", "cm", "kg", "g", "L", "mL", "set", "scatola", "confezione"];
export const PRIORITIES = ["Alta", "Media", "Bassa"];
/** Ordine del flusso di approvvigionamento; "Annullato" è sempre possibile finché la richiesta non è chiusa. */
export const PURCHASE_FLOW = ["Da valutare", "Approvato", "Ordinato", "In consegna", "Ricevuto"];

export type MovementType = "entrata" | "uscita" | "prestito" | "rientro" | "spostamento" | "smaltimento";
export const MOVEMENT_TYPES: { value: MovementType; label: string; hint: string; managerOnly: boolean }[] = [
  { value: "entrata", label: "Entrata", hint: "Arrivo di nuovo materiale o riassortimento", managerOnly: true },
  { value: "uscita", label: "Uscita", hint: "Utilizzo definitivo o consumo", managerOnly: false },
  { value: "prestito", label: "Prestito", hint: "Prelievo temporaneo per test o lavorazioni", managerOnly: false },
  { value: "rientro", label: "Rientro", hint: "Restituzione di materiale in prestito", managerOnly: false },
  { value: "spostamento", label: "Spostamento", hint: "Cambio di posizione fisica tra armadi o box", managerOnly: true },
  { value: "smaltimento", label: "Smaltimento", hint: "Eliminazione di materiale guasto, scaduto o esaurito", managerOnly: false },
];

export const EVENT_LABELS: Record<string, string> = {
  warehouse_created: "Area magazzino creata", warehouse_updated: "Area magazzino modificata", warehouse_archived: "Area magazzino archiviata",
  warehouse_restored: "Area magazzino ripristinata", location_created: "Posizione creata", location_updated: "Posizione modificata",
  location_archived: "Posizione archiviata", location_restored: "Posizione ripristinata", item_created: "Articolo inserito",
  item_updated: "Articolo modificato", item_archived: "Articolo archiviato", item_restored: "Articolo ripristinato",
  stock_in: "Entrata", stock_out: "Uscita", loan: "Prestito", return: "Rientro", move: "Spostamento", dispose: "Smaltimento",
};
export const MOVEMENT_EVENTS = new Set(["stock_in", "stock_out", "loan", "return", "move", "dispose"]);

export type StockState = "OK" | "RIORDINARE";
/** Stato scorta: RIORDINARE se la quantità è minore o uguale alla scorta minima. */
export const stockState = (quantity: number, minimum: number): StockState => (quantity <= minimum ? "RIORDINARE" : "OK");

/** Anteprima del codice SKU generato dal sistema: MEC|SCI - prime tre lettere del sottoteam - progressivo. */
export const skuPrefix = (area: Area, subteam: string) => `${area === "tecnica" ? "MEC" : "SCI"}-${subteam.slice(0, 3).toUpperCase()}`;

export const LOCATION_PATTERN = /^[A-Z]-\d{2}-[A-Z]\d{2}$/;

/** Controlla il formato [Scaffale]-[Ripiano]-[Box] (es. A-01-B01) e i limiti configurati dalla Logistica. Restituisce l'errore o null. */
export function validateLocationCode(raw: string, limits: InventorySettings): string | null {
  const code = raw.trim().toUpperCase();
  if (!LOCATION_PATTERN.test(code)) return "Usa il formato Scaffale-Ripiano-Box, ad esempio A-01-B01 (lettera, due cifre, lettera e due cifre).";
  if (code[0] > limits.shelf_max_letter) return `La lettera dello scaffale può arrivare fino a ${limits.shelf_max_letter}.`;
  const level = Number(code.slice(2, 4));
  if (level < 1 || level > limits.level_max) return `Il ripiano va da 01 a ${String(limits.level_max).padStart(2, "0")}.`;
  if (!limits.slot_letters.includes(code[5])) return `La lettera del box deve essere una tra: ${limits.slot_letters.split("").join(", ")}.`;
  const slot = Number(code.slice(6, 8));
  if (slot < 1 || slot > limits.slot_max) return `Il numero del box va da 01 a ${String(limits.slot_max).padStart(2, "0")}.`;
  return null;
}

export const euro = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
export const formatDate = (value: string | null) => (value ? new Date(`${value}T12:00:00`).toLocaleDateString("it-IT") : "—");
export const todayIso = (timeZone = "Europe/Rome") => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());

const ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN: "Non hai i permessi per questa operazione.",
  OPERATOR_NAME_REQUIRED: "Inserisci nome e cognome dell'operatore (da 2 a 160 caratteri).",
  PERSON_REQUIRED: "Indica la persona che effettua il movimento.",
  INVALID_INVENTORY_DATA: "Dati non validi: controlla area, sottoteam, stato, unità di misura e lunghezza dei testi.",
  INVALID_INVENTORY_MOVEMENT: "Movimento non valido: controlla tipo e quantità.",
  INVALID_MOVEMENT_DATE: "La data del movimento non può essere futura né più vecchia di un anno.",
  INSUFFICIENT_STOCK: "Quantità insufficiente in magazzino.",
  RETURN_EXCEEDS_LOAN: "Il rientro supera la quantità attualmente in prestito.",
  SAME_LOCATION: "L'articolo si trova già in questa posizione.",
  LOCATION_REQUIRED: "Scegli una posizione valida e non archiviata.",
  LOCATION_NOT_FOUND: "Posizione non trovata.",
  LOCATION_CODE_TAKEN: "Esiste già una posizione con questo codice.",
  INVALID_LOCATION_CODE: "Codice posizione non valido: usa il formato A-01-B01.",
  LOCATION_OUT_OF_RANGE: "Il codice è fuori dai limiti impostati per scaffali, ripiani e box.",
  ARCHIVE_ACTIVE_ITEMS_FIRST: "Archivia prima gli articoli attivi collocati qui.",
  WAREHOUSE_NOT_FOUND: "Area magazzino non trovata o archiviata.",
  WAREHOUSE_ARCHIVED: "L'area magazzino è archiviata.",
  ITEM_NOT_FOUND: "Articolo non trovato o archiviato.",
  INVALID_PURCHASE_REQUEST: "Richiesta non valida: controlla materiale, quantità e priorità.",
  PURCHASE_REQUEST_NOT_FOUND: "Richiesta di acquisto non trovata.",
  PURCHASE_REQUEST_CLOSED: "La richiesta è chiusa e non si può più modificare.",
  PURCHASE_STATUS_BACKWARDS: "Lo stato non può tornare a un passaggio precedente.",
  ORDER_DATE_REQUIRED: "Per questo stato serve la data dell'ordine.",
  RECEIVED_DATE_REQUIRED: "Per lo stato Ricevuto serve la data di ricezione.",
  INVALID_PURCHASE_DATES: "Le date non sono valide: non possono essere future e la ricezione non può precedere l'ordine.",
  PURCHASE_REQUEST_NOT_LINKABLE: "La richiesta deve essere in stato Ricevuto e non ancora collegata a un articolo.",
  "inventory_items_sku_unique": "Esiste già un articolo con questo SKU.",
};

export function inventoryErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : "";
  for (const [code, message] of Object.entries(ERROR_MESSAGES)) if (text.includes(code)) return message;
  return text || "Operazione non riuscita. Riprova.";
}

export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function toCsv(rows: unknown[][]): Blob {
  return new Blob(["﻿", rows.map((line) => line.map(csvCell).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function ledgerRows(events: InventoryEvent[]): unknown[][] {
  return [
    ["Data movimento", "Registrato il", "Evento", "SKU", "Articolo", "Area magazzino", "Variazione quantità", "Prima", "Dopo", "Da posizione", "A posizione", "Persona", "Motivo/progetto", "Operatore account", "Note", "Dettagli"],
    ...events.map((e) => [
      e.movement_date, new Date(e.created_at).toLocaleString("it-IT"), EVENT_LABELS[e.event_type] ?? e.event_type, e.sku_snapshot,
      e.item_name_snapshot, e.warehouse_name_snapshot, e.quantity_delta, e.quantity_before, e.quantity_after, e.from_location_code,
      e.to_location_code, e.taken_by_name, e.reason, e.actor_name, e.notes, e.details,
    ]),
  ];
}
