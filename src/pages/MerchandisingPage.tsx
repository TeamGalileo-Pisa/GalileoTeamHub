import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader";
import { Modal } from "../components/Modal";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "../lib/supabase";
import { downloadMerchOrdersExport } from "../lib/merch-orders-export";

type Variant = { id: string; product_id: string; label: string; stock: number | null; active: boolean };
type ProductVisibility = "team_leader" | "team_leader_and_area_leads" | "everyone";
type Product = { id: string; name: string; description: string; image_url: string | null; price_cents: number; active: boolean; visibility: ProductVisibility; variants: Variant[] };
type CartItem = { variantId: string; quantity: number };
type OrderItem = { id: string; product_id: string | null; variant_id: string | null; product_name: string; variant_label: string; unit_price_cents: number; quantity: number; line_total_cents: number };
type MerchOrder = { id: string; request_number: string; status: string; payment_method: string; total_cents: number; created_at: string; paid_at: string | null; buyer_user_id: string | null; buyer_first_name: string | null; buyer_last_name: string | null; buyer_email: string | null; items: OrderItem[] };
type OrderEditItem = { itemId?: string; variantId?: string; productName: string; variantLabel: string; unitPriceCents: number; quantity: number };
const euro = (cents: number) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(cents / 100);
const visibilityLabels: Record<ProductVisibility, string> = {
  team_leader: "Solo Team Leader",
  team_leader_and_area_leads: "Team Leader e capi area",
  everyone: "Tutti",
};
const parseStock = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
  const [labelRaw, stockRaw] = line.split(":");
  const label = labelRaw.trim();
  const stock = stockRaw?.trim() ? Number(stockRaw.trim()) : null;
  if (!label || (stock !== null && (!Number.isInteger(stock) || stock < 0))) throw new Error(`Disponibilità non valida per ${label || "una variante"}.`);
  return { label, stock };
});
const orderStatusLabel = (status: string) => status === "ordered" ? "Ordinato · da verificare" : status === "paid" ? "Pagato" : status === "pending" ? "Pagamento PayPal in corso" : status === "cancelled" ? "Annullato" : status === "expired" ? "Scaduto" : status;
async function fetchAllMerchOrders(): Promise<MerchOrder[]> {
  const orders: MerchOrder[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("merch_orders")
      .select("id,request_number,status,payment_method,total_cents,created_at,paid_at,buyer_user_id,buyer_first_name,buyer_last_name,buyer_email,items:merch_order_items(id,product_id,variant_id,product_name,variant_label,unit_price_cents,quantity,line_total_cents)")
      .order("created_at", { ascending: false }).range(offset, offset + 999);
    if (error) throw error;
    const batch = (data ?? []) as MerchOrder[];
    orders.push(...batch);
    if (batch.length < 1000) return orders;
  }
}
async function orderRequest<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("merch-paypal", { body });
  if (error) {
    const result = error.context instanceof Response ? await error.context.json().catch(() => ({})) : {};
    const messages: Record<string, string> = {
      OUT_OF_STOCK: "La quantità richiesta non è più disponibile.",
      UNAVAILABLE: "Uno dei prodotti scelti non è più disponibile.",
      FORBIDDEN: "Ordine non valido per questo account.",
      INVALID_STUDENT_EMAIL: "Inserisci un indirizzo istituzionale @studenti.unipi.it.",
      EMAIL_QUEUE_FAILED: "Non siamo riusciti a inviare la richiesta. Riprova tra poco.",
    };
    throw new Error(messages[result.error] ?? "Invio non riuscito. Riprova.");
  }
  return data as T;
}

export function MerchandisingPage() {
  const { access } = useAuth();
  const queryClient = useQueryClient();
  const canManage = Boolean(access?.isAdmin || access?.areas.some((area) => area.slug === "logistica"));
  const canPurchase = (product: Product) => product.visibility === "everyone" ||
    Boolean(access?.isTeamLeader) ||
    (product.visibility === "team_leader_and_area_leads" && Boolean(access?.areas.length && !access.isMember));
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [editingOrder, setEditingOrder] = useState<MerchOrder | null>(null);
  const [editItems, setEditItems] = useState<OrderEditItem[]>([]);
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editVariantId, setEditVariantId] = useState("");
  const [confirmPaymentAdjustment, setConfirmPaymentAdjustment] = useState(false);
  const [cancellingOrder, setCancellingOrder] = useState<MerchOrder | null>(null);
  const [confirmRefund, setConfirmRefund] = useState(false);
  const productsQuery = useQuery({
    queryKey: ["merch-products", access?.userId],
    queryFn: async () => {
      const { data, error } = await supabase.from("merch_products").select("id,name,description,image_url,price_cents,active,visibility,variants:merch_variants(id,product_id,label,stock,active)").order("sort_order").order("created_at");
      if (error) throw error;
      return (data ?? []) as Product[];
    },
  });
  const ordersQuery = useQuery({
    queryKey: ["merch-orders", access?.userId],
    enabled: canManage,
    queryFn: async () => {
      return fetchAllMerchOrders();
    },
  });
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);
  const publicOrderUrl = `${window.location.origin}/merchandising/ordine`;
  const cartTotal = useMemo(() => cart.reduce((sum, item) => {
    const variant = products.flatMap((p) => p.variants).find((v) => v.id === item.variantId);
    const product = products.find((p) => p.id === variant?.product_id);
    return sum + (product?.price_cents ?? 0) * item.quantity;
  }, 0), [cart, products]);
  const editTotal = useMemo(() => editItems.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0), [editItems]);

  async function saveProduct(form: FormData) {
    setError(""); setNotice("");
    try {
      const name = String(form.get("name") ?? "").trim();
      const description = String(form.get("description") ?? "").trim();
      const price = Number(String(form.get("price") ?? "").replace(",", "."));
      const visibility = String(form.get("visibility") ?? "everyone") as ProductVisibility;
      if (!name || !Number.isFinite(price) || price <= 0) throw new Error("Inserisci nome e prezzo validi.");
      if (!(visibility in visibilityLabels)) throw new Error("Scegli chi può vedere il prodotto.");
      const variants = parseStock(String(form.get("variants") ?? "S:\nM:\nL:\nXL:\n2XL:\n3XL:"));
      if (!variants.length) throw new Error("Aggiungi almeno una taglia o variante.");
      let imageUrl = editing?.image_url ?? null;
      const image = form.get("image");
      if (image instanceof File && image.size) {
        if (!/^image\/(jpeg|png|webp)$/.test(image.type) || image.size > 5 * 1024 * 1024) throw new Error("Usa un’immagine JPG, PNG o WebP entro 5 MB.");
        const filePath = `${access!.userId}/${crypto.randomUUID()}-${image.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
        const { error: uploadError } = await supabase.storage.from("galileo-merch").upload(filePath, image, { contentType: image.type, upsert: false });
        if (uploadError) throw uploadError;
        imageUrl = supabase.storage.from("galileo-merch").getPublicUrl(filePath).data.publicUrl;
      }
      let productId = editing?.id;
      if (productId) {
        const { error: updateError } = await supabase.from("merch_products").update({ name, description, image_url: imageUrl, price_cents: Math.round(price * 100), visibility }).eq("id", productId);
        if (updateError) throw updateError;
      } else {
        const { data, error: insertError } = await supabase.from("merch_products").insert({ name, description, image_url: imageUrl, price_cents: Math.round(price * 100), visibility, created_by: access!.userId }).select("id").single();
        if (insertError) throw insertError;
        productId = data.id;
      }
      const existing = editing?.variants ?? [];
      for (const old of existing) {
        const stillPresent = variants.some((v) => v.label.toLocaleLowerCase() === old.label.toLocaleLowerCase());
        if (!stillPresent) {
          const { error: e } = await supabase.from("merch_variants").update({ active: false }).eq("id", old.id);
          if (e) throw e;
        }
      }
      for (const variant of variants) {
        const old = existing.find((v) => v.label.toLocaleLowerCase() === variant.label.toLocaleLowerCase());
        const result = old
          ? await supabase.from("merch_variants").update({ active: true, stock: variant.stock }).eq("id", old.id)
          : await supabase.from("merch_variants").insert({ product_id: productId, label: variant.label, stock: variant.stock });
        if (result.error) throw result.error;
      }
      setEditing(null); setNotice("Prodotto salvato.");
      await queryClient.invalidateQueries({ queryKey: ["merch-products"] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Salvataggio non riuscito."); }
  }

  async function checkout() {
    setBusy(true); setError(""); setNotice("");
    try {
      if (!cart.length) throw new Error("Il carrello è vuoto.");
      if (!firstName.trim() || !lastName.trim()) throw new Error("Inserisci nome e cognome.");
      if (!/^[^@\s]+@studenti\.unipi\.it$/i.test(email.trim())) throw new Error("Inserisci un indirizzo istituzionale @studenti.unipi.it.");
      await orderRequest<{ submitted: boolean }>({ action: "member-order-email", firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim().toLowerCase(), items: cart });
      setNotice("Richiesta inviata. Ti arriverà una conferma all’indirizzo indicato; la logistica è in copia e ti confermerà disponibilità e ritiro.");
      setCart([]); setFirstName(""); setLastName(""); setEmail("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Impossibile inviare la richiesta."); }
    finally { setBusy(false); }
  }

  async function setOrderPaid(order: MerchOrder, paid: boolean) {
    setError(""); setNotice("");
    const { error } = await supabase.rpc("set_merch_order_paid", { p_order: order.id, p_paid: paid });
    if (error) { setError("Non è stato possibile aggiornare lo stato del pagamento."); return; }
    setNotice(paid ? `Richiesta ${order.request_number} segnata come pagata.` : `Richiesta ${order.request_number} riportata a non pagata.`);
    await queryClient.invalidateQueries({ queryKey: ["merch-orders", access?.userId] });
  }

  function startOrderEdit(order: MerchOrder) {
    setEditingOrder(order);
    setEditItems(order.items.map((item) => ({
      itemId: item.id,
      variantId: item.variant_id ?? undefined,
      productName: item.product_name,
      variantLabel: item.variant_label,
      unitPriceCents: item.unit_price_cents,
      quantity: item.quantity,
    })));
    setEditFirstName(order.buyer_first_name ?? "");
    setEditLastName(order.buyer_last_name ?? "");
    setEditEmail(order.buyer_email ?? "");
    setEditVariantId("");
    setConfirmPaymentAdjustment(false);
    setError(""); setNotice("");
  }

  function addOrderEditItem() {
    const variant = products.flatMap((product) => product.variants).find((item) => item.id === editVariantId && item.active);
    const product = products.find((item) => item.id === variant?.product_id && item.active);
    if (!variant || !product) return;
    const previous = editItems.find((item) => item.variantId === variant.id);
    const nextQuantity = (previous?.quantity ?? 0) + 1;
    const originallyReserved = editingOrder?.items.filter((item) => item.variant_id === variant.id).reduce((sum, item) => sum + item.quantity, 0) ?? 0;
    const availableForThisOrder = variant.stock === null ? 20 : variant.stock + originallyReserved;
    if (nextQuantity > Math.min(20, availableForThisOrder)) {
      setError(`Disponibilità insufficiente per ${product.name} · ${variant.label}.`);
      return;
    }
    setEditItems((old) => previous
      ? old.map((item) => item.variantId === variant.id ? { ...item, quantity: nextQuantity } : item)
      : [...old, { variantId: variant.id, productName: product.name, variantLabel: variant.label, unitPriceCents: product.price_cents, quantity: 1 }]);
    setEditVariantId(""); setError(""); setConfirmPaymentAdjustment(false);
  }

  async function saveOrderEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingOrder) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (!editItems.length) throw new Error("L’ordine deve contenere almeno un articolo; per chiuderlo usa Annulla ordine.");
      if (!/^[^@\s]+@studenti\.unipi\.it$/i.test(editEmail.trim())) throw new Error("Inserisci un indirizzo @studenti.unipi.it.");
      if (editingOrder.status === "paid" && editTotal !== editingOrder.total_cents && !confirmPaymentAdjustment) {
        throw new Error("Conferma di aver regolato su PayPal la differenza o l’eventuale rimborso.");
      }
      const { error } = await supabase.rpc("update_merch_order", {
        p_order: editingOrder.id,
        p_first_name: editFirstName.trim(),
        p_last_name: editLastName.trim(),
        p_email: editEmail.trim().toLowerCase(),
        p_items: editItems.map((item) => item.itemId ? { itemId: item.itemId, quantity: item.quantity } : { variantId: item.variantId, quantity: item.quantity }),
        p_confirm_payment_adjustment: confirmPaymentAdjustment,
      });
      if (error) {
        if (error.message.includes("OUT_OF_STOCK")) throw new Error("Disponibilità insufficiente per uno degli articoli.");
        if (error.message.includes("UNAVAILABLE")) throw new Error("Uno dei nuovi articoli non è più disponibile.");
        if (error.message.includes("PAYMENT_ADJUSTMENT_CONFIRMATION_REQUIRED")) throw new Error("Conferma la gestione della differenza di pagamento su PayPal.");
        throw new Error("Non è stato possibile aggiornare l’ordine.");
      }
      setEditingOrder(null);
      setNotice(`Ordine ${editingOrder.request_number} aggiornato. Le modifiche sono state registrate nello storico.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["merch-orders", access?.userId] }),
        queryClient.invalidateQueries({ queryKey: ["merch-products", access?.userId] }),
      ]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Aggiornamento non riuscito."); }
    finally { setBusy(false); }
  }

  async function confirmOrderCancellation() {
    if (!cancellingOrder) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const { error } = await supabase.rpc("cancel_managed_merch_order", {
        p_order: cancellingOrder.id,
        p_confirmed_refund: cancellingOrder.status === "paid" && confirmRefund,
      });
      if (error) {
        if (error.message.includes("REFUND_CONFIRMATION_REQUIRED")) throw new Error("Conferma prima che il rimborso PayPal sia stato gestito.");
        throw new Error("Non è stato possibile annullare l’ordine.");
      }
      setNotice(`Ordine ${cancellingOrder.request_number} annullato. La disponibilità è stata ripristinata e l’operazione registrata.`);
      setCancellingOrder(null); setConfirmRefund(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["merch-orders", access?.userId] }),
        queryClient.invalidateQueries({ queryKey: ["merch-products", access?.userId] }),
      ]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Annullamento non riuscito."); }
    finally { setBusy(false); }
  }

  async function downloadOrdersExcel() {
    setError("");
    try {
      await downloadMerchOrdersExport();
    } catch {
      setError("Non è stato possibile scaricare il registro ordini.");
    }
  }

  async function toggleProduct(product: Product) {
    const { error } = await supabase.from("merch_products").update({ active: !product.active }).eq("id", product.id);
    if (error) setError(error.message); else await queryClient.invalidateQueries({ queryKey: ["merch-products"] });
  }
  async function deleteProduct(product: Product) {
    if (!window.confirm(`Eliminare definitivamente “${product.name}” dal catalogo? Gli ordini già registrati conservano i dati storici.`)) return;
    setError(""); setNotice("");
    const { error } = await supabase.from("merch_products").delete().eq("id", product.id);
    if (error) {
      setError("Eliminazione non riuscita. Aggiorna la pagina e riprova.");
      return;
    }
    if (product.image_url) {
      try {
        const url = new URL(product.image_url);
        const prefix = "/storage/v1/object/public/galileo-merch/";
        const index = url.pathname.indexOf(prefix);
        if (index >= 0) await supabase.storage.from("galileo-merch").remove([decodeURIComponent(url.pathname.slice(index + prefix.length))]);
      } catch { /* The database deletion has succeeded; a stale image can be cleaned up separately. */ }
    }
    setNotice("Prodotto eliminato dal catalogo.");
    await queryClient.invalidateQueries({ queryKey: ["merch-products"] });
  }
  function add(variant: Variant) {
    setCart((old) => {
      const found = old.find((item) => item.variantId === variant.id);
      const next = (found?.quantity ?? 0) + 1;
      if (next > 20 || (variant.stock !== null && next > variant.stock)) { setError("Quantità superiore alla disponibilità massima per articolo."); return old; }
      setError("");
      return found ? old.map((item) => item.variantId === variant.id ? { ...item, quantity: next } : item) : [...old, { variantId: variant.id, quantity: 1 }];
    });
  }

  return <div className="page-container">
    <PageHeader title="Merchandising" eyebrow="Team Galileo" description={canManage ? "Gestisci prodotti, varianti, immagini, prezzi e disponibilità. Le richieste d’ordine arrivano via email alla logistica." : "Scegli prodotti, taglie e quantità; invia la richiesta alla logistica con il tuo indirizzo istituzionale."} />
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-success" role="status">{notice}</p>}{busy && <p role="status">Invio della richiesta in corso…</p>}
    {canManage && <section className="panel panel__body merch-admin">
      <p>Link pubblico per gli ordini: <a href={publicOrderUrl} target="_blank" rel="noreferrer">{publicOrderUrl}</a></p>
      <button className="button button--secondary" type="button" onClick={() => void navigator.clipboard?.writeText(publicOrderUrl)}>Copia link pubblico</button>
      <h2>{editing ? "Modifica prodotto" : "Aggiungi un prodotto"}</h2>
      <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void saveProduct(new FormData(event.currentTarget)); }} key={editing?.id ?? "new-product"}>
        <label className="form-field">Nome<input className="input" name="name" required maxLength={120} defaultValue={editing?.name ?? ""} /></label>
        <label className="form-field">Prezzo (€)<input className="input" name="price" type="number" min="0.01" step="0.01" required defaultValue={editing ? (editing.price_cents / 100).toFixed(2) : ""} /></label>
        <label className="form-field">Visibile a<select className="input" name="visibility" defaultValue={editing?.visibility ?? "everyone"}><option value="team_leader">Solo Team Leader</option><option value="team_leader_and_area_leads">Team Leader e capi area</option><option value="everyone">Tutti</option></select></label>
        <label className="form-field--full">Descrizione<textarea className="input" name="description" rows={3} maxLength={3000} defaultValue={editing?.description ?? ""} /></label>
        <label className="form-field--full">Taglie/varianti e scorte (una per riga, formato <code>taglia:quantità</code>; lascia vuoto dopo i due punti per disponibilità illimitata). Per l’abbigliamento usa S, M, L, XL, 2XL e 3XL.<textarea className="input" name="variants" rows={6} defaultValue={editing ? editing.variants.filter((v) => v.active).map((v) => `${v.label}:${v.stock ?? ""}`).join("\n") : "S:\nM:\nL:\nXL:\n2XL:\n3XL:"} /></label>
        <label className="form-field--full">Foto prodotto (JPG, PNG o WebP; massimo 5 MB)<input className="input" name="image" type="file" accept="image/jpeg,image/png,image/webp" /></label>
        <div className="form-field--full"><button className="button button--primary">{editing ? "Salva modifiche" : "Aggiungi prodotto"}</button> {editing && <button className="button button--secondary" type="button" onClick={() => setEditing(null)}>Annulla</button>}</div>
      </form>
    </section>}

    {productsQuery.isLoading ? <p>Caricamento catalogo…</p> : productsQuery.error ? <p role="alert">Catalogo non disponibile.</p> : <div className="merch-grid">
      {products.filter((p) => canManage || p.active).map((product) => <article className="panel merch-card" key={product.id}>
        {product.image_url && <img className="merch-card__image" src={product.image_url} alt={product.name} loading="lazy" />}
        <div className="panel__body"><div className="merch-card__heading"><h2>{product.name}</h2><strong>{euro(product.price_cents)}</strong></div>
          <p>{product.description || ""}</p>
          {!product.active && <p className="muted">Non visibile ai membri</p>}
          {canManage && <p className="muted">Visibilità catalogo: {visibilityLabels[product.visibility]}</p>}
          {canPurchase(product) && <div className="merch-variants">
            <label className="form-field">Seleziona la taglia
              <select className="input" aria-label={`${product.name}, taglia`} value={selectedVariants[product.id] ?? ""} onChange={(event) => setSelectedVariants((old) => ({ ...old, [product.id]: event.target.value }))}>
                <option value="">Scegli una taglia</option>
                {product.variants.filter((variant) => variant.active).map((variant) => <option key={variant.id} value={variant.id} disabled={variant.stock === 0}>{variant.label === "Unica" ? "Taglia unica" : `Taglia ${variant.label}`}{variant.stock !== null ? ` · ${variant.stock} disponibili` : ""}</option>)}
              </select>
            </label>
            {(() => {
              const variant = product.variants.find((item) => item.id === selectedVariants[product.id] && item.active);
              return <button className="button button--secondary" type="button" disabled={!variant || variant.stock === 0} onClick={() => variant && add(variant)}>Aggiungi al carrello</button>;
            })()}
          </div>}
          {canManage && <div className="merch-admin-actions"><button className="button button--secondary" type="button" onClick={() => setEditing(product)}>Modifica</button><button className="button button--secondary" type="button" onClick={() => void toggleProduct(product)}>{product.active ? "Nascondi" : "Riattiva"}</button><button className="button button--secondary" type="button" onClick={() => void deleteProduct(product)}>Elimina</button></div>}
        </div>
      </article>)}
      {products.filter((p) => canManage || p.active).length === 0 && <p>Nessun prodotto disponibile.</p>}
    </div>}

    <section className="panel panel__body merch-checkout"><h2>Il tuo ordine</h2>{cart.length ? cart.map((item) => {
      const variant = products.flatMap((p) => p.variants).find((v) => v.id === item.variantId)!;
      const product = products.find((p) => p.id === variant.product_id)!;
      return <div className="merch-variant" key={item.variantId}><span>{product.name} · {variant.label} × {item.quantity}</span><strong>{euro(product.price_cents * item.quantity)}</strong><button className="button button--secondary" type="button" onClick={() => setCart((old) => old.filter((i) => i.variantId !== item.variantId))}>Rimuovi</button></div>;
    }) : <p>Seleziona un prodotto per iniziare.</p>}
      {cart.length > 0 && <div className="form-grid">
        <label className="form-field">Nome<input className="input" autoComplete="given-name" required maxLength={100} value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label>
        <label className="form-field">Cognome<input className="input" autoComplete="family-name" required maxLength={100} value={lastName} onChange={(event) => setLastName(event.target.value)} /></label>
        <label className="form-field form-field--full">Email istituzionale
          <input className="input" type="email" autoComplete="email" inputMode="email" required maxLength={254} pattern="[^ @]+@studenti[.]unipi[.]it" title="Usa un indirizzo @studenti.unipi.it" placeholder="nome@studenti.unipi.it" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
      </div>}
      <div className="merch-total"><strong>Totale</strong><strong>{euro(cartTotal)}</strong></div><button className="button button--primary" type="button" disabled={!cart.length || busy} onClick={() => void checkout()}>{busy ? "Invio…" : "Invia richiesta d’ordine"}</button>
    </section>

    {canManage && <section className="panel panel__body merch-orders">
      <div className="merch-orders__header"><div><h2>Richieste e pagamenti</h2><p>Controlla le richieste ricevute e conferma quando il pagamento PayPal è arrivato.</p></div><button className="button button--secondary" type="button" onClick={() => void downloadOrdersExcel()}>Scarica registro Excel</button></div>
      {ordersQuery.isLoading ? <p>Caricamento richieste…</p> : ordersQuery.error ? <p role="alert">Registro ordini non disponibile.</p> : ordersQuery.data?.length ? <div className="merch-orders__list">{ordersQuery.data.map((order) => <article className="merch-order" key={order.id}>
        <div className="merch-order__top"><strong>Richiesta {order.request_number}</strong><span className={`merch-order__status merch-order__status--${order.status}`}>{orderStatusLabel(order.status)}</span></div>
        <span>{order.buyer_first_name ? `${order.buyer_first_name} ${order.buyer_last_name}` : "Cliente"}{order.buyer_email ? ` · ${order.buyer_email}` : ""}</span>
        <span>{new Date(order.created_at).toLocaleString("it-IT")} · Totale {euro(order.total_cents)}</span>
        <ul>{order.items.map((item, i) => <li key={`${order.id}-${i}`}>{item.product_name} · {item.variant_label} × {item.quantity} — {euro(item.line_total_cents)}</li>)}</ul>
        {order.payment_method === "paypal_manual" && order.status === "ordered" && <button className="button button--primary button--small" type="button" onClick={() => void setOrderPaid(order, true)}>Segna come pagato</button>}
        {order.payment_method === "paypal_manual" && order.status === "paid" && <button className="button button--secondary button--small" type="button" onClick={() => void setOrderPaid(order, false)}>Riporta a non pagato</button>}
        {order.payment_method === "paypal_manual" && ["ordered", "paid"].includes(order.status) && <div className="merch-order__actions">
          <button className="button button--secondary button--small" type="button" onClick={() => startOrderEdit(order)}>Modifica ordine</button>
          <button className="button button--danger button--small" type="button" onClick={() => { setCancellingOrder(order); setConfirmRefund(false); }}>Annulla ordine</button>
        </div>}
        {order.status === "pending" && <p className="muted">Ordine in pagamento PayPal: le modifiche sono disabilitate finché il pagamento è in corso.</p>}
      </article>)}</div> : <p>Nessuna richiesta d’ordine registrata.</p>}
    </section>}

    {editingOrder && <Modal title={`Modifica ordine ${editingOrder.request_number}`} onClose={() => { if (!busy) setEditingOrder(null); }}>
      <form className="form-grid merch-order-edit" onSubmit={(event) => void saveOrderEdit(event)}>
        <label className="form-field">Nome<input className="input" required maxLength={100} value={editFirstName} onChange={(event) => setEditFirstName(event.target.value)} /></label>
        <label className="form-field">Cognome<input className="input" required maxLength={100} value={editLastName} onChange={(event) => setEditLastName(event.target.value)} /></label>
        <label className="form-field form-field--full">Email istituzionale<input className="input" type="email" required maxLength={254} pattern="[^ @]+@studenti[.]unipi[.]it" title="Usa un indirizzo @studenti.unipi.it" value={editEmail} onChange={(event) => setEditEmail(event.target.value)} /></label>
        <div className="form-field--full">
          <h3>Articoli dell’ordine</h3>
          {editItems.map((item, index) => <div className="merch-order-edit__line" key={item.itemId ?? item.variantId}>
            <span>{item.productName} · {item.variantLabel}<small>{euro(item.unitPriceCents)} cad.</small></span>
            <label>Quantità<input className="input" type="number" min={1} max={20} value={item.quantity} aria-label={`Quantità ${item.productName} ${item.variantLabel}`} onChange={(event) => { const quantity = Number(event.target.value); if (Number.isInteger(quantity) && quantity >= 1 && quantity <= 20) { setEditItems((old) => old.map((line, i) => i === index ? { ...line, quantity } : line)); setConfirmPaymentAdjustment(false); } }} /></label>
            <strong>{euro(item.unitPriceCents * item.quantity)}</strong>
            <button className="button button--secondary button--small" type="button" disabled={editItems.length <= 1} aria-label={`Rimuovi ${item.productName} ${item.variantLabel}`} onClick={() => { setEditItems((old) => old.filter((_, i) => i !== index)); setConfirmPaymentAdjustment(false); }}>Rimuovi</button>
          </div>)}
          <p className="muted">Per svuotare l’ordine, usa “Annulla ordine”.</p>
        </div>
        <div className="form-field--full merch-order-edit__add">
          <label className="form-field">Aggiungi un articolo<select className="input" value={editVariantId} onChange={(event) => setEditVariantId(event.target.value)}>
            <option value="">Scegli prodotto e variante</option>
            {products.filter((product) => product.active && (editingOrder.buyer_user_id !== null || product.visibility === "everyone")).flatMap((product) => product.variants.filter((variant) => variant.active).map((variant) => <option key={variant.id} value={variant.id}>{product.name} · {variant.label}{variant.stock !== null ? ` · ${variant.stock} disponibili` : ""}</option>))}
          </select></label>
          <button className="button button--secondary" type="button" disabled={!editVariantId} onClick={addOrderEditItem}>Aggiungi</button>
        </div>
        <div className="form-field--full merch-order-edit__total"><strong>Nuovo totale</strong><strong>{euro(editTotal)}</strong></div>
        {editingOrder.status === "paid" && editTotal !== editingOrder.total_cents && <label className="form-field--full merch-order-edit__confirm"><input type="checkbox" checked={confirmPaymentAdjustment} onChange={(event) => setConfirmPaymentAdjustment(event.target.checked)} /> Confermo di aver regolato tramite PayPal la differenza o l’eventuale rimborso. Lo stato resterà “Pagato”.</label>}
        <div className="form-field--full form-actions"><button className="button button--secondary" type="button" disabled={busy} onClick={() => setEditingOrder(null)}>Indietro</button><button className="button button--primary" type="submit" disabled={busy || !editItems.length}>{busy ? "Salvataggio…" : "Salva ordine"}</button></div>
      </form>
    </Modal>}

    {cancellingOrder && <Modal title={`Annulla ordine ${cancellingOrder.request_number}`} onClose={() => { if (!busy) { setCancellingOrder(null); setConfirmRefund(false); } }}>
      <p>La richiesta verrà segnata come annullata e gli articoli torneranno disponibili in magazzino. L’operazione resterà nello storico.</p>
      {cancellingOrder.status === "paid" && <label className="merch-order-edit__confirm"><input type="checkbox" checked={confirmRefund} onChange={(event) => setConfirmRefund(event.target.checked)} /> Confermo che il rimborso PayPal è già stato gestito.</label>}
      <div className="form-actions"><button className="button button--secondary" type="button" disabled={busy} onClick={() => { setCancellingOrder(null); setConfirmRefund(false); }}>Indietro</button><button className="button button--danger" type="button" disabled={busy || (cancellingOrder.status === "paid" && !confirmRefund)} onClick={() => void confirmOrderCancellation()}>{busy ? "Annullamento…" : "Conferma annullamento"}</button></div>
    </Modal>}
  </div>;
}
