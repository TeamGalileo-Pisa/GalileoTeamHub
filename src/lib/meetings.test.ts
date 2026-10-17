import { describe, expect, it } from "vitest";
import { describeSlotRanges, meetingErrorMessage, slotsFromWindows } from "./meetings";

describe("slot di riunione", () => {
  it("divide le fasce di disponibilità in slot da 30 minuti", () => {
    expect(slotsFromWindows([{ start_time: "09:00:00", end_time: "10:30:00" }])).toEqual(["09:00", "09:30", "10:00"]);
  });

  it("unisce più fasce nello stesso giorno senza duplicati", () => {
    expect(
      slotsFromWindows([
        { start_time: "14:00:00", end_time: "15:00:00" },
        { start_time: "09:00:00", end_time: "10:00:00" },
      ]),
    ).toEqual(["09:00", "09:30", "14:00", "14:30"]);
  });

  it("raggruppa gli slot consecutivi selezionati", () => {
    expect(describeSlotRanges(["10:30", "09:00", "09:30"])).toEqual(["09:00–10:00", "10:30–11:00"]);
  });

  it("traduce gli errori del database", () => {
    expect(meetingErrorMessage(new Error("MEETING_SLOT_TAKEN"))).toMatch(/prenotato/);
  });
});

describe("arrotondamento orari", () => {
  it("porta gli orari alla mezz'ora più vicina", async () => {
    const { snapToHalfHour } = await import("./meetings");
    expect(snapToHalfHour("13:15")).toBe("13:30");
    expect(snapToHalfHour("13:14")).toBe("13:00");
    expect(snapToHalfHour("09:45")).toBe("10:00");
    expect(snapToHalfHour("23:59")).toBe("23:30");
    expect(snapToHalfHour("09:00")).toBe("09:00");
  });
});
