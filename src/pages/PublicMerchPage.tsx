import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { supabase } from "../lib/supabase";

type Variant = { id: string; label: string; stock: number | null };
type Product = { id: string; name: string; description: string; image_url: string | null; price_cents: number; variants: Variant[] };
type Line = { variantId: string; quantity: number };
type ProductSelection = { key: string; variantId: string; quantity: string };
const euro = (cents: number) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(cents / 100);

async function request<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("merch-paypal", { body });
  if (error) {
    const result = error.context instanceof Response ? await error.context.json().catch(() => ({})) : {};
    const messages: Record<string, string> = {
      OUT_OF_STOCK: "La quantità richiesta non è più disponibile.",
      UNAVAILABLE: "Uno dei prodotti scelti non è più disponibile.",
      PAYPAL_NOT_CONFIGURED: "PayPal non è ancora configurato sul server.",
      PAYPAL_MODE_INVALID: "La modalità PayPal sul server deve essere sandbox o live.",
      PAYPAL_AUTH_FAILED: "PayPal Live ha rifiutato le credenziali. Verifica che modalità e coppia Client ID/Secret siano entrambe Live (non Sandbox).",
      PAYPAL_ORDER_FAILED: "PayPal non è riuscito a creare il pagamento. Verifica le credenziali Live e riprova.",
      ORDER_EXPIRED: "La prenotazione è scaduta. Ripeti l’ordine.",
    };
    throw new Error(messages[result.error] ?? "Operazione non riuscita. Riprova.");
  }
  return data as T;
}

export function PublicMerchPage() {
  const catalog = useQuery({
    queryKey: ["public-merch-catalog"],
    queryFn: () => request<Product[]>({ action: "public-catalog" }),
  });
  const [selections, setSelections] = useState<Record<string, ProductSelection[]>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(() => new URLSearchParams(location.search).get("paypal") === "cancelled" ? "Pagamento annullato. Puoi riprovare." : "");
  const [busy, setBusy] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const products = useMemo(() => catalog.data ?? [], [catalog.data]);
  const selected = useMemo(() => products.flatMap((product) => {
    return (selections[product.id] ?? []).flatMap((selection) => {
      const variant = product.variants.find((item) => item.id === selection.variantId);
      const quantity = Number(selection.quantity);
      return variant && Number.isInteger(quantity) && quantity > 0
        ? [{ product, variant, quantity }]
        : [];
    });
  }), [products, selections]);
  const total = selected.reduce((sum, line) => sum + line.product.price_cents * line.quantity, 0);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const paypalOrderId = params.get("token");
    const orderId = params.get("order");
    if (params.get("paypal") === "cancelled") {
      history.replaceState(null, "", location.pathname);
      return;
    }
    if (params.get("paypal") !== "approved" || !paypalOrderId || !orderId) return;
    const checkoutToken = sessionStorage.getItem(`public-merch:${orderId}`);
    if (!checkoutToken) {
      queueMicrotask(() => setError("Non trovo i dati temporanei dell’ordine su questo browser. Contatta la logistica con il numero d’ordine."));
      history.replaceState(null, "", location.pathname);
      return;
    }
    queueMicrotask(() => setBusy(true));
    void request<{ paid: boolean }>({ action: "public-capture", orderId, paypalOrderId, checkoutToken })
      .then((result) => {
        if (result.paid) setNotice("Pagamento PayPal completato. L’ordine è confermato.");
        sessionStorage.removeItem(`public-merch:${orderId}`);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Pagamento non verificato."))
      .finally(() => {
        setBusy(false);
        history.replaceState(null, "", location.pathname);
      });
  }, []);

  async function checkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      if (!selected.length) throw new Error("Scegli almeno un prodotto.");
      const response = await request<{ orderId: string; checkoutToken: string; approvalUrl: string }>({
        action: "public-create", firstName, lastName,
        items: selected.map((line) => ({ variantId: line.variant.id, quantity: line.quantity } satisfies Line)),
      });
      sessionStorage.setItem(`public-merch:${response.orderId}`, response.checkoutToken);
      location.assign(response.approvalUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossibile avviare il pagamento.");
      setBusy(false);
    }
  }

  return <div className="page-container">
    <PageHeader title="Ordina il merchandising" eyebrow="Team Galileo · Link pubblico" description="Scegli prodotti, taglie e quantità, poi inserisci il nome per il ritiro. Il prezzo viene verificato dal server prima di aprire PayPal." />
    <p><Link to="/">Torna a GalileoHub</Link></p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="form-success" role="status">{notice}</p>}
    {busy && <p role="status">Verifica dell’ordine o pagamento in corso…</p>}
    {catalog.isLoading ? <p>Caricamento catalogo…</p> : catalog.error ? <p role="alert">Catalogo non disponibile. Riprova più tardi.</p> : <form onSubmit={(event) => void checkout(event)}>
      <div className="merch-grid">
        {products.map((product) => <article className="panel merch-card" key={product.id}>
          {product.image_url && <img className="merch-card__image" src={product.image_url} alt={product.name} loading="lazy" />}
          <div className="panel__body"><div className="merch-card__heading"><h2>{product.name}</h2><strong>{euro(product.price_cents)}</strong></div>
            {product.description && <p>{product.description}</p>}
            <fieldset className="merch-size-picker">
              <legend>Personalizza il tuo articolo</legend>
              {product.variants.length ? <>
                <div className="merch-product-options">
                  {(selections[product.id] ?? []).map((selection, index) => {
                    const currentVariant = product.variants.find((variant) => variant.id === selection.variantId);
                    const chosenElsewhere = new Set((selections[product.id] ?? []).filter((row) => row.key !== selection.key).map((row) => row.variantId));
                    return <div className="merch-size-row" key={selection.key}>
                      <label className="merch-option-field">
                        <span>Taglia</span>
                        <select
                          className="select"
                          aria-label={`${product.name}, taglia ${index + 1}`}
                          value={selection.variantId}
                          onChange={(event) => setSelections((old) => ({
                            ...old,
                            [product.id]: (old[product.id] ?? []).map((row) => row.key === selection.key ? { ...row, variantId: event.target.value, quantity: "" } : row),
                          }))}
                        >
                          <option value="">Seleziona taglia</option>
                          {product.variants.map((variant) => <option key={variant.id} value={variant.id} disabled={variant.stock === 0 || (chosenElsewhere.has(variant.id) && variant.id !== selection.variantId)}>
                            {variant.label === "Unica" ? "Taglia unica" : variant.label}{variant.stock === 0 ? " · Esaurita" : ""}
                          </option>)}
                        </select>
                      </label>
                      <label className="merch-option-field">
                        <span>Quantità</span>
                        <input
                          className="input"
                          aria-label={`${product.name}, quantità taglia ${index + 1}`}
                          type="number"
                          inputMode="numeric"
                          min="1"
                          max={Math.min(20, currentVariant?.stock ?? 20)}
                          placeholder="1"
                          value={selection.quantity}
                          disabled={!selection.variantId}
                          onChange={(event) => setSelections((old) => ({
                            ...old,
                            [product.id]: (old[product.id] ?? []).map((row) => row.key === selection.key ? { ...row, quantity: event.target.value === "0" ? "" : event.target.value } : row),
                          }))}
                        />
                      </label>
                      <button
                        className="button button--secondary button--small merch-size-remove"
                        type="button"
                        aria-label={`Rimuovi taglia ${currentVariant?.label ?? index + 1} da ${product.name}`}
                        onClick={() => setSelections((old) => ({ ...old, [product.id]: (old[product.id] ?? []).filter((row) => row.key !== selection.key) }))}
                      >Rimuovi</button>
                      {currentVariant && currentVariant.stock !== null && <small className="merch-stock-note">{currentVariant.stock} disponibili</small>}
                    </div>;
                  })}
                </div>
                <button
                  className="button button--secondary button--small merch-add-size"
                  type="button"
                  disabled={product.variants.every((variant) => variant.stock === 0) || (selections[product.id]?.length ?? 0) >= product.variants.length}
                  onClick={() => setSelections((old) => ({
                    ...old,
                    [product.id]: [...(old[product.id] ?? []), { key: crypto.randomUUID(), variantId: "", quantity: "" }],
                  }))}
                >+ Aggiungi un’altra taglia</button>
              </> : <p className="field-help">Le taglie non sono ancora disponibili per questo prodotto.</p>}
            </fieldset>
          </div>
        </article>)}
        {!products.length && <p>Nessun prodotto disponibile.</p>}
      </div>
      <section className="panel panel__body merch-checkout">
        <h2>I tuoi dati e il totale</h2>
        <div className="form-grid">
          <label className="form-field">Nome<input className="input" autoComplete="given-name" required maxLength={100} value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label>
          <label className="form-field">Cognome<input className="input" autoComplete="family-name" required maxLength={100} value={lastName} onChange={(event) => setLastName(event.target.value)} /></label>
        </div>
        {selected.length ? selected.map((line) => <div className="merch-variant" key={line.variant.id}><span>{line.product.name} · {line.variant.label} × {line.quantity}</span><strong>{euro(line.product.price_cents * line.quantity)}</strong></div>) : <p>Seleziona articoli e quantità.</p>}
        <div className="merch-total"><strong>Totale</strong><strong>{euro(total)}</strong></div>
        <button className="button button--primary" type="submit" disabled={!selected.length || busy || !products.length}>{busy ? "Attendi…" : `Paga ${euro(total)} con PayPal`}</button>
      </section>
    </form>}
  </div>;
}

