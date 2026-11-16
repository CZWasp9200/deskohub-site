import { describe, expect, test } from "bun:test";
import { FakeWorkspace } from "./fake-workspace";
import { sampleHistoryOf, withSampleHistory } from "./sample-history";

const workspace = (history: Parameters<typeof withSampleHistory>[1]) =>
  withSampleHistory(FakeWorkspace.forKind("linked"), history);

describe("withSampleHistory", () => {
  test("today's booking carries its PIN", () => {
    const [first] = workspace("today").data.history.current;
    expect(first?.todayAccess).toBeDefined();
  });

  test("the next booking is the one each variant names", () => {
    expect(workspace("upcoming").data.history.current[0]?.status).toBe(
      "confirmed"
    );
    expect(workspace("pending").data.history.current[0]?.status).toBe(
      "pending"
    );
    const nothing = workspace("nothing-upcoming").data.history;
    expect(nothing.current).toEqual([]);
    expect(nothing.past.length).toBeGreaterThan(0);
  });

  test("empty lists nothing; offline never answers the list", () => {
    expect(workspace("empty").data.history).toEqual({
      current: [],
      past: [],
      unavailable: [],
    });
    expect(workspace("offline").nextOutcome("listReservations")).toBe(
      "service-unavailable"
    );
  });

  test("loading never answers the list or a status", () => {
    const loading = workspace("loading");
    expect(loading.nextOutcome("listReservations")).toBe("hang");
    expect(loading.nextOutcome("getReservationStatus")).toBe("hang");
  });

  test("an unknown variant reads as today", () => {
    expect(sampleHistoryOf(undefined)).toBe("today");
    expect(sampleHistoryOf("nonsense")).toBe("today");
  });
});
