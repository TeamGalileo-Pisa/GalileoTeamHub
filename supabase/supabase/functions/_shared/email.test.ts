import { afterEach, describe, expect, it, vi } from "vitest";
import { sendGmailMessage, sendQueuedEmail } from "./email";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.112.4";
const message = {
  to: "recipient@example.test",
  subject: "Test",
  text: "Test",
  idempotencyId: "unit-delivery",
};
const payload = {
  delivery_id: "unit-delivery",
  attempt_count: 1,
  kind: "booking_confirmation",
  to_email: message.to,
  candidate_name: "Test Candidate",
  area_name: "Software",
  room_name: "A27",
  starts_at: "2099-09-21T07:00Z",
  ends_at: "2099-09-21T07:20Z",
};
function setup(existing = false) {
  vi.stubGlobal("Deno", {
    env: {
      get: (key: string) =>
        key === "EMAIL_PROVIDER"
          ? "gmail"
          : key === "SUPABASE_URL"
            ? undefined
            : "unit-placeholder",
    },
  });
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ access_token: "unit-placeholder" }))
    .mockResolvedValueOnce(
      Response.json({ emailAddress: "info.teamgalileo@gmail.com" }),
    )
    .mockResolvedValueOnce(
      Response.json({ messages: existing ? [{ id: "existing-message" }] : [] }),
    );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());
describe("Gmail transport and queue", () => {
  it("sends MIME through Gmail after checking Message-ID", async () => {
    const fetchMock = setup();
    fetchMock.mockResolvedValueOnce(Response.json({ id: "sent-id" }));
    expect(await sendGmailMessage(message)).toBe("sent-id");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const raw = JSON.parse(fetchMock.mock.calls[3][1].body).raw;
    const mime = atob(raw.replaceAll("-", "+").replaceAll("_", "/"));
    expect(mime).toContain(
      "From: Team Galileo Pisa <info.teamgalileo@gmail.com>",
    );
    expect(mime).toContain(
      "Message-ID: <unit-delivery@colloqui.teamgalileo.local>",
    );
  });
  it("does not send when Message-ID already exists", async () => {
    const fetchMock = setup(true);
    expect(await sendGmailMessage(message)).toBe("existing-message");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("does not resend an uncertain delivery", async () => {
    const fetchMock = setup();
    await expect(
      sendGmailMessage({ ...message, reconcileOnly: true }),
    ).rejects.toThrow("GMAIL_SEND_UNCERTAIN");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("records ambiguous provider timeouts for reconciliation", async () => {
    const fetchMock = setup();
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    await expect(sendGmailMessage(message)).rejects.toThrow(
      "GMAIL_SEND_UNCERTAIN",
    );
  });
  it("rejects a token for the wrong Gmail account", async () => {
    vi.stubGlobal("Deno", { env: { get: () => "unit-placeholder" } });
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ access_token: "unit-placeholder" }),
      )
      .mockResolvedValueOnce(
        Response.json({ emailAddress: "other@example.test" }),
      );
    vi.stubGlobal("fetch", f);
    await expect(sendGmailMessage(message)).rejects.toThrow(
      "GMAIL_WRONG_SENDER",
    );
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("keeps booking independent from provider errors", async () => {
    const f = setup();
    f.mockResolvedValueOnce(new Response(null, { status: 429 }));
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: payload, error: null })
      .mockResolvedValue({ error: null });
    await expect(
      sendQueuedEmail({ rpc } as unknown as SupabaseClient, "unit-delivery"),
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenLastCalledWith("mark_email_delivery_failed", {
      p_delivery_id: "unit-delivery",
      p_error: "GMAIL_SEND_FAILED:429",
      p_attempt: 1,
    });
  });
  it("never marks unconfigured email as sent", async () => {
    vi.stubGlobal("Deno", { env: { get: () => undefined } });
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: payload, error: null })
      .mockResolvedValue({ error: null });
    await sendQueuedEmail(
      { rpc } as unknown as SupabaseClient,
      "unit-delivery",
    );
    expect(rpc).toHaveBeenLastCalledWith(
      "mark_email_delivery_failed",
      expect.objectContaining({ p_error: "EMAIL_NOT_CONFIGURED" }),
    );
  });
  it("does nothing if the delivery was already claimed", async () => {
    const f = setup();
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await sendQueuedEmail(
      { rpc } as unknown as SupabaseClient,
      "unit-delivery",
    );
    expect(f).not.toHaveBeenCalled();
  });
  it("fences the acknowledgement with attempt number", async () => {
    const f = setup();
    f.mockResolvedValueOnce(Response.json({ id: "sent-id" }));
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: payload, error: null })
      .mockResolvedValue({ error: null });
    await sendQueuedEmail(
      { rpc } as unknown as SupabaseClient,
      "unit-delivery",
    );
    expect(rpc).toHaveBeenLastCalledWith("mark_email_delivery_sent", {
      p_delivery_id: "unit-delivery",
      p_provider_message_id: "sent-id",
      p_attempt: 1,
    });
  });
});
