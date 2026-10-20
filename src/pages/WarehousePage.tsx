import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { ItemsTab, type Sheet } from "../components/warehouse/ItemsTab";
import { LocationsTab } from "../components/warehouse/LocationsTab";
import { MovementsTab } from "../components/warehouse/MovementsTab";
import { PurchasesTab } from "../components/warehouse/PurchasesTab";
import { useInventory } from "../hooks/useInventory";
import { inventoryErrorMessage } from "../lib/inventory";

const TABS = [
  { id: "inventario", label: "Inventario" },
  { id: "tecnico", label: "Tecnico" },
  { id: "analisi", label: "Analisi" },
  { id: "posizioni", label: "Posizioni" },
  { id: "movimenti", label: "Movimenti" },
  { id: "acquisti", label: "Acquisti" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function WarehousePage() {
  const api = useInventory();
  const [params, setParams] = useSearchParams();
  const requested = params.get("scheda");
  const tab: TabId = TABS.some((entry) => entry.id === requested) ? (requested as TabId) : "inventario";

  if (!api.canView) {
    return <div className="page-container"><PageHeader title="Magazzino" eyebrow="Accesso riservato" description="Questa sezione è disponibile a Logistica, Team Leader, Amministrazione e Capi Area." /><section className="panel panel__body"><p>Il tuo account non è abilitato a questo magazzino.</p></section></div>;
  }

  const loadError = api.items.error ?? api.locations.error ?? api.warehouses.error ?? api.history.error ?? api.purchases.error ?? api.settings.error;

  return (
    <div className="page-container warehouse-page">
      <PageHeader title="Magazzino" eyebrow="Inventario · Posizioni · Movimenti · Acquisti" description="Controlla le scorte, registra i movimenti del materiale e richiedi nuovi acquisti." />
      {loadError && <p className="form-error" role="alert">{inventoryErrorMessage(loadError)}</p>}

      {api.canManage && (
        <section className="panel panel__body warehouse-operator">
          <label className="form-field">Nome e cognome dell'operatore
            <input className="input" required minLength={2} maxLength={160} value={api.operatorName} onChange={(event) => api.setOperatorName(event.target.value)} placeholder="Chi sta registrando le operazioni" />
          </label>
          <p>L'account viene registrato automaticamente. Qui indica solo chi sta effettuando l'operazione.</p>
        </section>
      )}

      <nav className="warehouse-tabs" role="tablist" aria-label="Schede del magazzino">
        {TABS.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} className={`warehouse-tab${tab === entry.id ? " warehouse-tab--active" : ""}`}
            onClick={() => setParams(entry.id === "inventario" ? {} : { scheda: entry.id }, { replace: true })}>{entry.label}</button>
        ))}
      </nav>

      {(tab === "inventario" || tab === "tecnico" || tab === "analisi") && <ItemsTab key={tab} api={api} sheet={tab as Sheet} />}
      {tab === "posizioni" && <LocationsTab api={api} />}
      {tab === "movimenti" && <MovementsTab api={api} />}
      {tab === "acquisti" && <PurchasesTab api={api} />}
    </div>
  );
}
