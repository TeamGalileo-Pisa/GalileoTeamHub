import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DailyAvailabilityForm } from "../components/DailyAvailabilityForm";
import { CalendarPage } from "./CalendarPage";
import { PublicBookingPage } from "./PublicBookingPage";

const mocks = vi.hoisted(() => ({
  book: vi.fn(),
  availability: vi.fn(),
  privacy: vi.fn(),
  rpc: vi.fn(),
  admin: true,
}));

vi.mock("../lib/config", () => ({
  appConfig: { hasSupabaseConfiguration: true, timezone: "Europe/Rome" },
}));
vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ access: { userId: "test-staff", isAdmin: mocks.admin } }),
}));
vi.mock("../lib/data", () => ({
  getPublicBookingAvailability: mocks.availability,
  listAreas: async () => [
    { id: "software", name: "Software" },
    { id: "rover", name: "Rover" },
  ],
}));
vi.mock("../lib/hub-enhancements", () => ({
  createPublicBookingWithPrivacy: mocks.book,
  getPublicPrivacyDocument: mocks.privacy,
  deleteBookingPermanently: vi.fn(),
  deleteSlotPermanently: vi.fn(),
}));
vi.mock("../lib/operations", () => ({ rpc: mocks.rpc }));

const slot = {
  id: "a1000000-0000-4000-8000-000000000001",
  startsAt: "2099-09-21T07:00Z",
  endsAt: "2099-09-21T07:20Z",
  roomName: "A27",
};

function mount(element: React.ReactNode, path = "/") {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={element} />
          <Route path="/book/:token" element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.admin = true;
  mocks.book.mockReset();
  mocks.rpc.mockReset().mockResolvedValue([]);
  mocks.availability.mockResolvedValue({
    sessionName: "Colloqui Software",
    areaName: "Software",
    slots: [slot],
  });
  mocks.privacy.mockResolvedValue({
    key: "privacy",
    title: "Informativa privacy test",
    body: "Testo informativa privacy sufficientemente lungo per il test.",
    version: 3,
    updatedAt: "2026-09-04T18:00:00Z",
  });
});

afterEach(cleanup);

describe("public booking screen", () => {
  it("shows every missing field including privacy and does not call booking API", async () => {
    mount(<PublicBookingPage />, "/book/test");
    fireEvent.click(await screen.findByRole("button", { name: "Conferma prenotazione" }));
    await screen.findByText("Inserisci il nome.");
    expect(screen.getByText("Inserisci il cognome.")).toBeInTheDocument();
    expect(screen.getByText("Inserisci il tuo indirizzo email universitario.")).toBeInTheDocument();
    expect(screen.getAllByText("Seleziona prima uno degli orari disponibili.")).toHaveLength(2);
    expect(screen.getByText("Devi leggere e accettare l'informativa privacy.")).toBeInTheDocument();
    expect(mocks.book).not.toHaveBeenCalled();
  });

  it("refuses non-university emails visibly", async () => {
    mount(<PublicBookingPage />, "/book/test");
    fireEvent.click(await screen.findByRole("button", { name: /09:00/ }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Mario" } });
    fireEvent.change(screen.getByLabelText("Cognome"), { target: { value: "Rossi" } });
    fireEvent.change(screen.getByLabelText("Email universitaria"), { target: { value: "mario@gmail.com" } });
    fireEvent.click(screen.getByLabelText(/Ho letto e accetto obbligatoriamente/));
    fireEvent.click(screen.getByRole("button", { name: "Conferma prenotazione" }));
    expect(await screen.findByText(/Per prenotare il colloquio devi utilizzare/)).toBeInTheDocument();
    expect(mocks.book).not.toHaveBeenCalled();
  });

  it("requires explicit privacy acceptance", async () => {
    mount(<PublicBookingPage />, "/book/test");
    fireEvent.click(await screen.findByRole("button", { name: /09:00/ }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Mario" } });
    fireEvent.change(screen.getByLabelText("Cognome"), { target: { value: "Rossi" } });
    fireEvent.change(screen.getByLabelText("Email universitaria"), { target: { value: "mario@studenti.unipi.it" } });
    fireEvent.click(screen.getByRole("button", { name: "Conferma prenotazione" }));
    expect(await screen.findByText("Devi leggere e accettare l'informativa privacy.")).toBeInTheDocument();
    expect(mocks.book).not.toHaveBeenCalled();
  });

  it("shows success only after server confirmation and sends privacy version", async () => {
    mocks.book.mockResolvedValue({
      bookingId: "booking",
      candidateName: "Mario Rossi",
      areaName: "Software",
      ...slot,
    });
    mount(<PublicBookingPage />, "/book/test");
    fireEvent.click(await screen.findByRole("button", { name: /09:00/ }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: " Mario " } });
    fireEvent.change(screen.getByLabelText("Cognome"), { target: { value: " Rossi " } });
    fireEvent.change(screen.getByLabelText("Email universitaria"), { target: { value: " Mario@STUDENTI.UNIPI.IT " } });
    fireEvent.click(screen.getByLabelText(/Ho letto e accetto obbligatoriamente/));
    fireEvent.click(screen.getByRole("button", { name: "Conferma prenotazione" }));

    expect(await screen.findByRole("heading", { name: "Grazie per la tua prenotazione!" })).toBeInTheDocument();
    expect(screen.getByText(/entro massimo 5 minuti/)).toBeInTheDocument();
    expect(screen.getByText(/cartella Spam/)).toBeInTheDocument();
    expect(mocks.book).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: "Mario",
        lastName: "Rossi",
        email: "mario@studenti.unipi.it",
        slotId: slot.id,
        privacyAccepted: true,
        privacyVersion: 3,
      }),
    );
  });
});

describe("daily availability and calendar UI", () => {
  it("previews all five dates", () => {
    mount(<DailyAvailabilityForm rooms={[]} onSuccess={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Data iniziale"), { target: { value: "2026-09-21" } });
    fireEvent.change(screen.getByLabelText("Data finale"), { target: { value: "2026-09-25" } });
    expect(screen.getByText("Verranno create 5 disponibilità")).toBeInTheDocument();
    expect(screen.getByText(/21 settembre 2026/)).toBeInTheDocument();
    expect(screen.getByText(/25 settembre 2026/)).toBeInTheDocument();
  });

  it("supports list/week switching and admin area filter", async () => {
    mount(<CalendarPage />);
    fireEvent.click(screen.getByRole("button", { name: "Calendario" }));
    expect(screen.getByText("Ora")).toBeInTheDocument();
    await screen.findByRole("option", { name: "Software" });
    fireEvent.change(screen.getByLabelText("Area"), { target: { value: "software" } });
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        "list_calendar_bookings",
        expect.objectContaining({ p_area_id: "software" }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Lista" }));
    expect(screen.queryByText("Ora")).not.toBeInTheDocument();
  });

  it("does not offer cross-area filters to area leads", async () => {
    mocks.admin = false;
    mount(<CalendarPage />);
    await screen.findByText(/Nessun appuntamento o slot libero/);
    expect(screen.queryByLabelText("Area")).not.toBeInTheDocument();
  });
});
