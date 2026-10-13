import { describe, expect, test } from "bun:test";
import {
  getAdministrationOperationFilters,
  getAdministrationOrderDateTimeBounds,
  getAdministrationPaymentDateTimeBounds,
} from "./payment-administration-filters";

describe("payment administration filters", () => {
  test("orders a reversed date range before querying Nexi", () => {
    const range = getAdministrationOrderDateTimeBounds(
      "2026-08-10",
      "2026-08-01",
      Temporal.PlainDate.from("2026-08-06")
    );

    expect(range.from).toBe("2026-08-01");
    expect(range.to).toBe("2026-08-10");
    expect(Temporal.Instant.compare(range.fromTime, range.toTime)).toBeLessThan(
      0
    );
  });

  test("falls back to the last week for missing or unreadable dates", () => {
    const current = Temporal.PlainDate.from("2026-08-06");

    for (const [from, to] of [
      [undefined, undefined],
      ["", ""],
      ["not-a-date", "2026-13-40"],
    ] as const) {
      const range = getAdministrationOrderDateTimeBounds(from, to, current);

      expect(range.from).toBe("2026-07-30");
      expect(range.to).toBe("2026-08-06");
    }
  });

  test("caps provider queries to Nexi's one-month maximum", () => {
    const range = getAdministrationOrderDateTimeBounds(
      "2026-06-01",
      "2026-08-01",
      Temporal.PlainDate.from("2026-08-06")
    );

    expect(range.from).toBe("2026-06-01");
    expect(range.to).toBe("2026-06-30");
    expect(range.toTime).toBe("2026-06-30T22:00:00Z");
  });

  test("preserves multi-month operation searches", () => {
    const range = getAdministrationPaymentDateTimeBounds(
      "2026-06-01",
      "2026-08-01",
      Temporal.PlainDate.from("2026-08-06")
    );

    expect(range.from).toBe("2026-06-01");
    expect(range.to).toBe("2026-08-01");
  });

  test("drops unsupported provider filters from deep links", () => {
    expect(
      getAdministrationOperationFilters({
        channel: "arbitrary-channel",
        operationType: "arbitrary-operation",
      })
    ).toEqual({ channel: undefined, operationType: undefined });
  });

  test("preserves filters offered by the UI", () => {
    expect(
      getAdministrationOperationFilters({
        channel: "BACKOFFICE",
        operationType: "REFUND",
      })
    ).toEqual({ channel: "BACKOFFICE", operationType: "REFUND" });
  });
});
