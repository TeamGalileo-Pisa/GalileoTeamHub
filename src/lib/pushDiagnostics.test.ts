import { describe, expect, it } from "vitest";
import { permissionLabel, pushServiceName } from "./pushDiagnostics";

describe("pushServiceName", () => {
  it.each([
    ["https://fcm.googleapis.com/fcm/send/abc", "Google (Android e Chrome)"],
    ["https://web.push.apple.com/QWxs", "Apple (iPhone, iPad e Safari)"],
    ["https://updates.push.services.mozilla.com/wpush/v2/x", "Mozilla (Firefox)"],
    ["https://wns2-db5p.notify.windows.com/w/?token=x", "Microsoft (Edge e Windows)"],
    ["https://example.com/push", "sconosciuto"],
    ["non un indirizzo", "sconosciuto"],
  ])("riconosce %s", (endpoint, expected) => {
    expect(pushServiceName(endpoint)).toBe(expected);
  });
});

describe("permissionLabel", () => {
  it("descrive i tre stati del permesso", () => {
    expect(permissionLabel("granted")).toBe("Consentite");
    expect(permissionLabel("default")).toBe("Non ancora richieste");
    expect(permissionLabel("denied")).toContain("Bloccate");
  });
});
