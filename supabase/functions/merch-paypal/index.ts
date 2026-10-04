import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/service-client.ts";
import { requireActor } from "../_shared/actor.ts";

const mode = () => Deno.env.get("PAYPAL_MODE") === "live" ? "live" : "sandbox";
const apiBase = () => mode() === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
const appBase = () => (Deno.env.get("PUBLIC_APP_URL") ?? "https://galileohub.info-teamgalileo.workers.dev").replace(/\/$/, "");
const money = (cents: number) => (cents / 100).toFixed(2);
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map((byte) => byte.toString(16).padStart(2, "0")).join("");

async function paypalToken() {
  const clientId = Deno.env.get("PAYPAL_CLIENT_ID");
  const secret = Deno.env.get("PAYPAL_CLIENT_SECRET");
  if (!clientId || !secret) throw new Error("PAYPAL_NOT_CONFIGURED");
  const response = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${clientId}:${secret}`)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) throw new Error("PAYPAL_AUTH_FAILED");
  return (await response.json()).access_token as string;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (request.method !== "POST") return jsonResponse(request, { error: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const raw = await request.text();
    if (raw.length > 24000) throw new Error("INVALID_DATA");
    const body = JSON.parse(raw);
    const service = createServiceClient();
    if (body.action === "public-catalog") {
      const { data, error } = await service.from("merch_products")
        .select("id,name,description,image_url,price_cents,variants:merch_variants(id,label,stock)")
        .eq("active", true).eq("visibility", "everyone")
        .eq("variants.active", true).order("sort_order").order("created_at");
      if (error) throw new Error("CATALOG_UNAVAILABLE");
      return jsonResponse(request, data ?? []);
    }
    if (body.action === "public-create") {
      if (typeof body.firstName !== "string" || body.firstName.trim().length < 1 || body.firstName.length > 100 ||
        typeof body.lastName !== "string" || body.lastName.trim().length < 1 || body.lastName.length > 100 ||
        !Array.isArray(body.items) || body.items.length === 0 || body.items.length > 30 ||
        body.items.some((item: Record<string, unknown>) => typeof item.variantId !== "string" || !/^[0-9a-f-]{36}$/i.test(item.variantId) || !Number.isInteger(item.quantity) || Number(item.quantity) < 1 || Number(item.quantity) > 20) ||
        new Set(body.items.map((item: Record<string, unknown>) => item.variantId)).size !== body.items.length) throw new Error("INVALID_ORDER");
      const checkoutToken = Array.from(crypto.getRandomValues(new Uint8Array(32))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const { data, error } = await service.rpc("create_public_merch_order", {
        p_first_name: body.firstName.trim(), p_last_name: body.lastName.trim(),
        p_token_hash: await sha256(checkoutToken),
        p_items: body.items.map((item: Record<string, unknown>) => ({ variantId: item.variantId, quantity: item.quantity })),
      });
      if (error) throw new Error(error.message.includes("OUT_OF_STOCK") ? "OUT_OF_STOCK" : error.message.includes("UNAVAILABLE") ? "UNAVAILABLE" : "INVALID_ORDER");
      const order = data?.[0];
      if (!order) throw new Error("ORDER_FAILED");
      try {
        const token = await paypalToken();
        const { data: lines, error: lineError } = await service.from("merch_order_items")
          .select("product_name,variant_label,quantity,unit_price_cents").eq("order_id", order.order_id);
        if (lineError || !lines?.length) throw new Error("ORDER_FAILED");
        const response = await fetch(`${apiBase()}/v2/checkout/orders`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "paypal-request-id": order.order_id },
          body: JSON.stringify({
            intent: "CAPTURE",
            purchase_units: [{ reference_id: order.order_id, custom_id: order.order_id,
              invoice_id: `GH-${order.order_id}`,
              amount: { currency_code: "EUR", value: money(order.total_cents), breakdown: { item_total: { currency_code: "EUR", value: money(order.total_cents) } } },
              items: lines.map((line: Record<string, unknown>) => ({ name: String(line.product_name).slice(0, 127), description: String(line.variant_label).slice(0, 127), quantity: String(line.quantity), unit_amount: { currency_code: "EUR", value: money(Number(line.unit_price_cents)) } })),
            }],
            application_context: { brand_name: "Team Galileo", user_action: "PAY_NOW", return_url: `${appBase()}/merchandising/ordine?paypal=approved&order=${order.order_id}`, cancel_url: `${appBase()}/merchandising/ordine?paypal=cancelled` },
          }),
        });
        const result = await response.json();
        if (!response.ok || !result.id) throw new Error("PAYPAL_ORDER_FAILED");
        const approvalUrl = result.links?.find((link: { rel: string; href: string }) => link.rel === "approve")?.href;
        if (!approvalUrl) throw new Error("PAYPAL_ORDER_FAILED");
        const { error: updateError } = await service.from("merch_orders").update({ paypal_order_id: result.id }).eq("id", order.order_id);
        if (updateError) throw new Error("ORDER_FAILED");
        return jsonResponse(request, { orderId: order.order_id, checkoutToken, approvalUrl });
      } catch (error) {
        await service.rpc("cancel_merch_order", { p_order: order.order_id });
        throw error;
      }
    }
    if (body.action === "public-capture") {
      if (typeof body.orderId !== "string" || typeof body.paypalOrderId !== "string" || typeof body.checkoutToken !== "string" || !/^[a-f0-9]{64}$/.test(body.checkoutToken)) throw new Error("INVALID_ORDER");
      const { data: order, error } = await service.from("merch_orders")
        .select("id,status,total_cents,paypal_order_id,paypal_capture_id,expires_at,public_checkout_token_hash")
        .eq("id", body.orderId).is("buyer_user_id", null).single();
      const suppliedHash = await sha256(body.checkoutToken);
      if (error || !order || order.public_checkout_token_hash !== suppliedHash) throw new Error("FORBIDDEN");
      if (order.status === "paid") return jsonResponse(request, { paid: true });
      if (order.status !== "pending" || order.paypal_order_id !== body.paypalOrderId) throw new Error("INVALID_ORDER");
      if (new Date(order.expires_at).getTime() <= Date.now()) {
        await service.rpc("cancel_merch_order", { p_order: order.id });
        throw new Error("ORDER_EXPIRED");
      }
      const token = await paypalToken();
      const response = await fetch(`${apiBase()}/v2/checkout/orders/${encodeURIComponent(body.paypalOrderId)}/capture`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "paypal-request-id": `capture-${body.orderId}` }, body: "{}" });
      const result = await response.json();
      if (!response.ok || result.status !== "COMPLETED") throw new Error("PAYMENT_NOT_COMPLETED");
      const capture = result.purchase_units?.[0]?.payments?.captures?.[0];
      if (!capture?.id || result.purchase_units?.[0]?.custom_id !== order.id || capture.amount?.currency_code !== "EUR" || Math.round(Number(capture.amount?.value) * 100) !== order.total_cents) throw new Error("PAYMENT_AMOUNT_MISMATCH");
      const { error: updateError } = await service.from("merch_orders").update({ status: "paid", paypal_capture_id: capture.id, paid_at: new Date().toISOString() }).eq("id", order.id).eq("status", "pending").eq("paypal_order_id", body.paypalOrderId);
      if (updateError) throw new Error("ORDER_UPDATE_FAILED");
      return jsonResponse(request, { paid: true });
    }
    const { client, user } = await requireActor(request, false);
    if (body.action === "config") {
      return jsonResponse(request, { configured: Boolean(Deno.env.get("PAYPAL_CLIENT_ID") && Deno.env.get("PAYPAL_CLIENT_SECRET")), clientId: Deno.env.get("PAYPAL_CLIENT_ID") ?? null, mode: mode() });
    }
    if (body.action === "create") {
      if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 30 || body.items.some((item: Record<string, unknown>) => typeof item.variantId !== "string" || !Number.isInteger(item.quantity) || Number(item.quantity) < 1 || Number(item.quantity) > 20) || new Set(body.items.map((item: Record<string, unknown>) => item.variantId)).size !== body.items.length) throw new Error("INVALID_ORDER");
      const items = body.items.map((item: Record<string, unknown>) => ({ variantId: item.variantId, quantity: item.quantity }));
      const { data, error } = await client.rpc("create_merch_order", { p_buyer: user.id, p_items: items });
      if (error) throw new Error(error.message.includes("OUT_OF_STOCK") ? "OUT_OF_STOCK" : error.message.includes("UNAVAILABLE") ? "UNAVAILABLE" : "INVALID_ORDER");
      const order = data?.[0];
      if (!order) throw new Error("ORDER_FAILED");
      try {
        const token = await paypalToken();
        const { data: lines, error: lineError } = await client.from("merch_order_items").select("product_name,variant_label,quantity,unit_price_cents,line_total_cents").eq("order_id", order.order_id);
        if (lineError || !lines?.length) throw new Error("ORDER_FAILED");
        const response = await fetch(`${apiBase()}/v2/checkout/orders`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "paypal-request-id": order.order_id },
          body: JSON.stringify({
            intent: "CAPTURE",
            purchase_units: [{
              reference_id: order.order_id,
              custom_id: order.order_id,
              invoice_id: `GH-${order.order_id}`,
              amount: { currency_code: "EUR", value: money(order.total_cents), breakdown: { item_total: { currency_code: "EUR", value: money(order.total_cents) } } },
              items: lines.map((line: Record<string, unknown>) => ({ name: String(line.product_name).slice(0, 127), description: String(line.variant_label).slice(0, 127), quantity: String(line.quantity), unit_amount: { currency_code: "EUR", value: money(Number(line.unit_price_cents)) } })),
            }],
            application_context: { brand_name: "Team Galileo", user_action: "PAY_NOW", return_url: `${appBase()}/merchandising?paypal=approved&order=${order.order_id}`, cancel_url: `${appBase()}/merchandising?paypal=cancelled` },
          }),
        });
        const result = await response.json();
        if (!response.ok || !result.id) throw new Error("PAYPAL_ORDER_FAILED");
        const approvalUrl = result.links?.find((link: { rel: string; href: string }) => link.rel === "approve")?.href;
        if (!approvalUrl) throw new Error("PAYPAL_ORDER_FAILED");
        const { error: updateError } = await client.from("merch_orders").update({ paypal_order_id: result.id }).eq("id", order.order_id).eq("buyer_user_id", user.id);
        if (updateError) throw new Error("ORDER_FAILED");
        return jsonResponse(request, { orderId: order.order_id, paypalOrderId: result.id, approvalUrl });
      } catch (error) {
        await client.rpc("cancel_merch_order", { p_order: order.order_id });
        throw error;
      }
    }
    if (body.action === "capture") {
      if (typeof body.orderId !== "string" || typeof body.paypalOrderId !== "string") throw new Error("INVALID_ORDER");
      const { data: order, error } = await client.from("merch_orders").select("id,buyer_user_id,status,total_cents,paypal_order_id,paypal_capture_id,expires_at").eq("id", body.orderId).single();
      if (error || !order || order.buyer_user_id !== user.id) throw new Error("FORBIDDEN");
      if (order.status === "paid") return jsonResponse(request, { paid: true });
      if (order.status !== "pending" || order.paypal_order_id !== body.paypalOrderId) throw new Error("INVALID_ORDER");
      if (new Date(order.expires_at).getTime() <= Date.now()) {
        await client.rpc("cancel_merch_order", { p_order: order.id });
        throw new Error("ORDER_EXPIRED");
      }
      const token = await paypalToken();
      const response = await fetch(`${apiBase()}/v2/checkout/orders/${encodeURIComponent(body.paypalOrderId)}/capture`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "paypal-request-id": `capture-${body.orderId}` }, body: "{}" });
      const result = await response.json();
      if (!response.ok || result.status !== "COMPLETED") throw new Error("PAYMENT_NOT_COMPLETED");
      const capture = result.purchase_units?.[0]?.payments?.captures?.[0];
      const customId = result.purchase_units?.[0]?.custom_id;
      if (!capture?.id || customId !== order.id || capture.amount?.currency_code !== "EUR" || Math.round(Number(capture.amount?.value) * 100) !== order.total_cents) throw new Error("PAYMENT_AMOUNT_MISMATCH");
      const { error: updateError } = await client.from("merch_orders").update({ status: "paid", paypal_capture_id: capture.id, paid_at: new Date().toISOString() }).eq("id", order.id).eq("status", "pending").eq("paypal_order_id", body.paypalOrderId);
      if (updateError) throw new Error("ORDER_UPDATE_FAILED");
      return jsonResponse(request, { paid: true });
    }
    throw new Error("INVALID_DATA");
  } catch (cause) {
    const raw = cause instanceof Error ? cause.message : "INVALID_DATA";
    const allowed = ["UNAUTHORIZED","FORBIDDEN","INVALID_DATA","INVALID_ORDER","UNAVAILABLE","OUT_OF_STOCK","ORDER_FAILED","ORDER_EXPIRED","PAYPAL_NOT_CONFIGURED","PAYPAL_AUTH_FAILED","PAYPAL_ORDER_FAILED","PAYMENT_NOT_COMPLETED","PAYMENT_AMOUNT_MISMATCH","ORDER_UPDATE_FAILED","CATALOG_UNAVAILABLE"];
    const error = allowed.includes(raw) ? raw : "ORDER_FAILED";
    return jsonResponse(request, { error }, error === "UNAUTHORIZED" ? 401 : error === "FORBIDDEN" ? 403 : 400);
  }
});

