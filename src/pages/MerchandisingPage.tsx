import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "../lib/supabase";

type Variant = { id: string; product_id: string; label: string; stock: number | null; active: boolean };
type ProductVisibility = "team_leader" | "team_leader_and_area_leads" | "everyone";
type Product = { id: string; name: string; description: string; image_url: string | null; price_cents: number; active: boolean; visibility: ProductVisibility; variants: Variant[] };
type CartItem = { variantId: string; quantity: number };
type PayResult = { configured?: boolean; approvalUrl?: string; paypalOrderId?: string; paid?: boolean };
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
async function paypalRequest<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("merch-paypal", { body });
  if (error) {
    const result = error.context instanceof Response ? await error.context.json().catch(() => ({})) : {};
    const messages: Record<string, string> = {
      PAYPAL_NOT_CONFIGURED: "PayPal non è ancora configurato sul server.", OUT_OF_STOCK: "La quantità richiesta non è più disponibile.",
      UNAVAILABLE: "Uno dei prodotti scelti non è più disponibile.", PAYMENT_NOT_COMPLETED: "PayPal non ha completato il pagamento.",
      FORBIDDEN: "Ordine non valido per questo account.", ORDER_EXPIRED: "La prenotazione è scaduta. Ripeti l’ordine.",
    };
    throw new Error(messages[result.error] ?? "Operazione PayPal non riuscita. Riprova.");
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
  const [notice, setNotice] = useState(() => new URLSearchParams(window.location.search).get("paypal") === "cancelled" ? "Pagamento annullato. Il carrello è ancora disponibile." : "");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Product | null>(null);
  const [payBusy, setPayBusy] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("paypal") === "approved" && Boolean(params.get("token") && params.get("order"));
  });
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
      const { data, error } = await supabase.from("merch_orders").select("id,status,total_cents,created_at,buyer_first_name,buyer_last_name,items:merch_order_items(product_name,variant_label,quantity,line_total_cents)").eq("status", "paid").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);
  const publicOrderUrl = `${window.location.origin}/merchandising/ordine`;
  const cartTotal = useMemo(() => cart.reduce((sum, item) => {
    const variant = products.flatMap((p) => p.variants).find((v) => v.id === item.variantId);
    const product = products.find((p) => p.id === variant?.product_id);
    return sum + (product?.price_cents ?? 0) * item.quantity;
  }, 0), [cart, products]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const paypalId = params.get("token");
    const localOrder = params.get("order");
    if (params.get("paypal") === "cancelled") {
      history.replaceState(null, "", location.pathname);
      return;
    }
    if (params.get("paypal") !== "approved" || !paypalId || !localOrder) return;
    let alive = true;
    void paypalRequest<PayResult>({ action: "capture", orderId: localOrder, paypalOrderId: paypalId })
      .then((result) => { if (alive && result.paid) { setNotice("Pagamento PayPal completato. L’ordine è confermato."); setCart([]); void queryClient.invalidateQueries({ queryKey: ["merch-orders"] }); } })
      .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : "Pagamento non verificato."); })
      .finally(() => { if (alive) { setPayBusy(false); history.replaceState(null, "", location.pathname); } });
    return () => { alive = false; };
  }, [queryClient]);

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
    setPayBusy(true); setError(""); setNotice("");
    try {
      if (!cart.length) throw new Error("Il carrello è vuoto.");
      const result = await paypalRequest<PayResult>({ action: "create", items: cart });
      if (!result.approvalUrl) throw new Error("PayPal non è ancora configurato. Riprova più tardi.");
      location.assign(result.approvalUrl);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Impossibile avviare il pagamento."); setPayBusy(false); }
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
    <PageHeader title="Merchandising" eyebrow="Team Galileo" description={canManage ? "Gestisci prodotti, varianti, immagini, prezzi e disponibilità. Gli ordini si pagano in euro con PayPal." : "Scegli il prodotto e la taglia. Il totale del carrello viene calcolato prima del pagamento PayPal."} />
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-success" role="status">{notice}</p>}{payBusy && <p role="status">Verifica o avvio del pagamento in corso…</p>}
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
          <div className="merch-variants">{product.variants.filter((v) => v.active).map((variant) => <div className="merch-variant" key={variant.id}><span>{variant.label === "Unica" ? "Taglia unica" : `Taglia ${variant.label}`}{variant.stock !== null ? ` · ${variant.stock} disponibili` : ""}</span>{canPurchase(product) && <button className="button button--secondary" type="button" disabled={variant.stock === 0} onClick={() => add(variant)}>Aggiungi</button>}</div>)}</div>
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
      <div className="merch-total"><strong>Totale</strong><strong>{euro(cartTotal)}</strong></div><button className="button button--primary" type="button" disabled={!cart.length || payBusy} onClick={() => void checkout()}>{payBusy ? "Attendi…" : `Paga ${euro(cartTotal)} con PayPal`}</button>
    </section>

    {canManage && <section className="panel panel__body"><h2>Ordini pagati e confermati</h2>{ordersQuery.data?.length ? ordersQuery.data.map((order) => <article className="merch-order" key={order.id}><strong>Pagato e confermato</strong><span>{order.buyer_first_name ? `${order.buyer_first_name} ${order.buyer_last_name} · ` : ""}{new Date(order.created_at).toLocaleString("it-IT")} · {euro(order.total_cents)}</span><ul>{order.items.map((item, i) => <li key={i}>{item.product_name} · {item.variant_label} × {item.quantity}</li>)}</ul></article>) : <p>Nessun ordine pagato e confermato.</p>}</section>}
  </div>;
}
