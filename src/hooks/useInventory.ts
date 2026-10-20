import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { ledgerRows, toCsv, type InventoryEvent, type InventoryItem, type InventoryLocation, type InventorySettings, type PurchaseRequest, type Warehouse } from "../lib/inventory";
import { useAuth } from "./useAuth";

const OPERATOR_KEY = "galileo-warehouse-operator";
const readOperator = () => { try { return localStorage.getItem(OPERATOR_KEY) ?? ""; } catch { return ""; } };

async function readLedger() {
  const rows: InventoryEvent[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("inventory_movements").select("*").order("id", { ascending: true }).range(offset, offset + 999);
    if (error) throw error;
    const batch = (data ?? []) as InventoryEvent[];
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  return rows;
}

export type BackupState = "idle" | "syncing" | "saved" | "error";

/**
 * Dati e permessi del magazzino.
 * - canManage: Logistica, Team Leader e Amministrazione (articoli, posizioni, entrate, spostamenti, stati degli acquisti).
 * - canView: anche tutti i Capi Area (consultano, registrano uscite/prestiti/rientri/smaltimenti e chiedono acquisti).
 */
export function useInventory() {
  const { access } = useAuth();
  const cache = useQueryClient();
  const canManage = Boolean(access?.isAdmin || access?.areas.some((area) => area.slug === "logistica"));
  const canView = Boolean(canManage || (access && !access.isMember && access.areas.length > 0));
  const [operatorName, setOperatorState] = useState(readOperator);
  const [backupState, setBackupState] = useState<BackupState>("idle");
  const [backupError, setBackupError] = useState("");

  const setOperatorName = (value: string) => {
    setOperatorState(value);
    try { localStorage.setItem(OPERATOR_KEY, value); } catch { /* facoltativo */ }
  };

  const warehouses = useQuery({ queryKey: ["inventory-warehouses"], enabled: canView, queryFn: async () => {
    const { data, error } = await supabase.from("inventory_warehouses").select("*").order("created_at");
    if (error) throw error;
    return data as Warehouse[];
  } });
  const locations = useQuery({ queryKey: ["inventory-locations"], enabled: canView, queryFn: async () => {
    const { data, error } = await supabase.from("inventory_locations").select("*").order("code");
    if (error) throw error;
    return data as InventoryLocation[];
  } });
  const items = useQuery({ queryKey: ["inventory-items"], enabled: canView, queryFn: async () => {
    const { data, error } = await supabase.from("inventory_items").select("*").order("sku");
    if (error) throw error;
    return data as InventoryItem[];
  } });
  const settings = useQuery({ queryKey: ["inventory-settings"], enabled: canView, queryFn: async () => {
    const { data, error } = await supabase.from("inventory_settings").select("shelf_max_letter, level_max, slot_letters, slot_max").eq("id", true).single();
    if (error) throw error;
    return data as InventorySettings;
  } });
  const history = useQuery({ queryKey: ["inventory-history"], enabled: canView, queryFn: async () => {
    const { data, error } = await supabase.from("inventory_movements").select("*").order("id", { ascending: false }).limit(300);
    if (error) throw error;
    return data as InventoryEvent[];
  } });
  const purchases = useQuery({ queryKey: ["inventory-purchases"], enabled: canView, queryFn: async () => {
    const { data, error } = await supabase.from("inventory_purchase_requests").select("*").order("seq", { ascending: false });
    if (error) throw error;
    return data as PurchaseRequest[];
  } });

  const refresh = useCallback(() => Promise.all(
    ["inventory-warehouses", "inventory-locations", "inventory-items", "inventory-settings", "inventory-history", "inventory-purchases"]
      .map((key) => cache.invalidateQueries({ queryKey: [key] })),
  ), [cache]);

  /** Copia CSV privata del registro: la aggiornano solo gli account che gestiscono il magazzino. */
  const syncLedger = useCallback(async () => {
    if (!canManage) return null;
    setBackupState("syncing");
    setBackupError("");
    try {
      const rows = await readLedger();
      const { error } = await supabase.storage.from("inventory-audit").upload("registro-magazzino.csv", toCsv(ledgerRows(rows)), { upsert: true, contentType: "text/csv", cacheControl: "0" });
      if (error) throw error;
      setBackupState("saved");
      return rows.length;
    } catch (error) {
      setBackupState("error");
      setBackupError(error instanceof Error ? error.message : "Impossibile aggiornare la copia esterna.");
      return null;
    }
  }, [canManage]);

  useEffect(() => {
    if (!canManage) return;
    const id = window.setTimeout(() => void syncLedger(), 0);
    return () => window.clearTimeout(id);
  }, [canManage, syncLedger]);

  /** Chiama una funzione del database aggiungendo il nome dell'operatore. I gestori (account condivisi) devono indicarlo. */
  const write = useCallback(async <T,>(name: string, args: Record<string, unknown>) => {
    if (canManage && operatorName.trim().length < 2) throw new Error("OPERATOR_NAME_REQUIRED");
    const { data, error } = await supabase.rpc(name, { ...args, p_actor_name: operatorName.trim() });
    if (error) throw error;
    void refresh();
    void syncLedger();
    return data as T;
  }, [canManage, operatorName, refresh, syncLedger]);

  return {
    access, canManage, canView, operatorName, setOperatorName, write, refresh, syncLedger, backupState, backupError, readLedger,
    warehouses, locations, items, settings, history, purchases,
  };
}

export type InventoryApi = ReturnType<typeof useInventory>;
