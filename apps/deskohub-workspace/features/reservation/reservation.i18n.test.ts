import { describe, expect, test } from "bun:test";
import { m } from "@/features/i18n";

describe("reservation offer copy", () => {
  test("availability unavailable message names the selected setup and date", () => {
    const reservedDeskName = "Reserved Desk – Afternoon";
    for (const locale of ["en-US", "cs-CZ"] as const) {
      const openSpace = m.reservationAvailabilityUnavailable(
        { tier: "Open Space", date: "12. 9. 2026" },
        { locale }
      );
      expect(openSpace).toContain("Open Space");
      expect(openSpace).toContain("12. 9. 2026");

      const reservedDesk = m.reservationAvailabilityUnavailable(
        { tier: reservedDeskName, date: "3. 10. 2026" },
        { locale }
      );
      expect(reservedDesk).toContain(reservedDeskName);
      expect(reservedDesk).toContain("3. 10. 2026");
    }
  });
});
