import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { WarehousePage } from "./WarehousePage";

const mocks = vi.hoisted(() => ({
  access: { userId: "u1", displayName: "Capo Software", isAdmin: false, isMember: false, areas: [{ slug: "software" }] } as Record<string, unknown>,
  rpc: vi.fn(),
}));

vi.mock("../lib/config", () => ({ appConfig: { hasSupabaseConfiguration: true, timezone: "Europe/Rome" } }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ access: mocks.access }) }));

const item = {
  id: "i1", warehouse_id: "w1", location_id: "l1", area: "tecnica", subteam: "Motore", sku: "MEC-MOT-001", name: "Motore DC", category: "Motori",
  description: "", unit: "pz", quantity: 2, minimum_quantity: 5, on_loan: 1, owner_name: "Anna", project_use: "Rover", supplier: "", unit_cost: 10,
  total_value: 20, purchase_date: null, expiry_date: null, notes: "", tech_specs: "12V", status: "Disponibile", archived_at: null, updated_at: "2026-10-20",
};
const data: Record<string, unknown> = {
  inventory_warehouses: [{ id: "w1", name: "Magazzino tecnico", location: "", notes: "", archived_at: null }],
  inventory_locations: [{ id: "l1", warehouse_id: "w1", code: "A-01-B01", shelf_label: "Scaffale A", level_label: "1", box_label: "Box 1", main_content: "Elettronica", notes: "", archived_at: null }],
  inventory_items: [item, { ...item, id: "i2", sku: "MEC-MOT-002", name: "Motore stepper", quantity: 20, on_loan: 0 }],
  inventory_settings: { shelf_max_letter: "F", level_max: 5, slot_letters: "BR", slot_max: 20 },
  inventory_movements: [],
  inventory_purchase_requests: [{ id: "p1", code: "ACQ-001", request_date: "2026-10-20", material: "Cuscinetti", area: "tecnica", quantity: 20, priority: "Alta", requester_user_id: "u1", requester_name: "Capo Software", reason: "", supplier: "", estimated_cost: 45, status: "Da valutare", order_date: null, received_date: null, notes: "", item_id: null, created_at: "2026-10-20" }],
};

vi.mock("../lib/supabase", () => {
  const builder = (table: string) => {
    const result = { data: data[table], error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "order", "limit", "range", "eq"]) chain[method] = () => chain;
    chain.single = async () => result;
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return chain;
  };
  return { supabase: { from: builder, rpc: mocks.rpc, storage: { from: () => ({ upload: async () => ({ error: null }) }) } } };
});

function mount() {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={cache}><MemoryRouter><WarehousePage /></MemoryRouter></QueryClientProvider>);
}

// jsdom non implementa <dialog>.showModal()
HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Magazzino", () => {
  it("mostra ai Capi Area le sei schede ma non i comandi di gestione", async () => {
    mocks.access = { userId: "u1", displayName: "Capo Software", isAdmin: false, isMember: false, areas: [{ slug: "software" }] };
    mount();
    for (const name of ["Inventario", "Tecnico", "Analisi", "Posizioni", "Movimenti", "Acquisti"]) expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    expect(await screen.findByText("MEC-MOT-001")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /aggiungi articolo/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/nome e cognome dell'operatore/i)).not.toBeInTheDocument();
    // stato scorta calcolato: 2 <= 5 → RIORDINARE, 20 > 5 → OK
    const rows = (await screen.findAllByRole("row")).slice(1);
    expect(within(rows[0]).getByText("RIORDINARE")).toBeInTheDocument();
    expect(within(rows[1]).getByText("OK")).toBeInTheDocument();
  });

  it("nega l'accesso a un membro di un'altra area", () => {
    mocks.access = { userId: "u2", displayName: "Membro", isAdmin: false, isMember: true, areas: [{ slug: "software" }] };
    mount();
    expect(screen.getByText(/non è abilitato/i)).toBeInTheDocument();
  });

  it("la Logistica vede i comandi di gestione e registra un movimento con l'operatore", async () => {
    mocks.access = { userId: "u3", displayName: "Capo Logistica", isAdmin: false, isMember: false, areas: [{ slug: "logistica" }] };
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    mount();
    expect(await screen.findByRole("button", { name: /aggiungi articolo/i })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/nome e cognome dell'operatore/i), "Mario Rossi");
    await userEvent.click(screen.getAllByRole("button", { name: /registra un movimento/i })[0]);
    const dialog = await screen.findByRole("dialog", { hidden: true });
    expect(within(dialog).getByRole("option", { name: "Entrata" })).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^Persona/), { target: { value: "Anna Bianchi" } });
    fireEvent.submit(within(dialog).getByRole("button", { name: /registra movimento/i }).closest("form")!);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("inventory_record_movement", expect.objectContaining({ p_item_id: "i1", p_type: "uscita", p_person: "Anna Bianchi", p_actor_name: "Mario Rossi" })));
  });

  it("un Capo Area non può registrare Entrate né Spostamenti", async () => {
    mocks.access = { userId: "u1", displayName: "Capo Software", isAdmin: false, isMember: false, areas: [{ slug: "software" }] };
    mount();
    await userEvent.click((await screen.findAllByRole("button", { name: /registra un movimento/i }))[0]);
    const dialog = await screen.findByRole("dialog", { hidden: true });
    expect(within(dialog).queryByRole("option", { name: "Entrata" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("option", { name: "Spostamento" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: "Prestito" })).toBeInTheDocument();
  });
});
