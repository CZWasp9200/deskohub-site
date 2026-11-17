import { describe, expect, test } from "bun:test";
import { DateTime, Duration } from "effect";
import { appLocales } from "../../i18n/app-locale";
import { formatInstant } from "../../i18n/date-time-format";
import { AccessWindowState, accessWindowState } from "./access-window";
import {
  AccessChip,
  AccessMoment,
  AccessWindowSpan,
  accessChipOf,
  accessChipText,
  accessDaysText,
  accessMomentParts,
  accessWindowSpanOf,
} from "./access-window-text";
import { shortDate } from "./booking-ticket-text";

// November in Prague is UTC+1: Prague midnight on the 26th is 23:00 UTC on the 25th.
const at = (iso: string) => DateTime.makeUnsafe(iso);
const pragueMidnight26 = at("2026-11-25T23:00:00Z");
const pragueMidnight27 = at("2026-11-26T23:00:00Z");
const pragueMidnight29 = at("2026-11-28T23:00:00Z");
const fivePm26 = at("2026-11-26T16:00:00Z");
const ninePm26 = at("2026-11-26T20:00:00Z");
const tenAm27 = at("2026-11-27T09:00:00Z");

const window = (startsAt: DateTime.Utc, endsAt: DateTime.Utc) => ({
  startsAt,
  endsAt,
});

describe("accessWindowSpanOf", () => {
  test("a window within one day lists From and Until", () => {
    expect(accessWindowSpanOf(window(pragueMidnight26, fivePm26))).toEqual(
      AccessWindowSpan.Times({ from: pragueMidnight26, until: fivePm26 })
    );
  });

  test("a window across days lists From and Until", () => {
    expect(accessWindowSpanOf(window(ninePm26, tenAm27))).toEqual(
      AccessWindowSpan.Times({ from: ninePm26, until: tenAm27 })
    );
  });

  test("a full day is one day, ending on that same day", () => {
    const span = accessWindowSpanOf(window(pragueMidnight26, pragueMidnight27));
    expect(span._tag).toBe("Days");
    if (span._tag !== "Days") return;
    expect(DateTime.isLessThan(span.last, pragueMidnight27)).toBe(true);
    for (const locale of appLocales) {
      expect(accessDaysText(span.first, span.last, locale)).toBe(
        accessDaysText(span.first, span.first, locale)
      );
    }
  });

  test("several full days name their first and last day", () => {
    const span = accessWindowSpanOf(window(pragueMidnight26, pragueMidnight29));
    expect(span._tag).toBe("Days");
    if (span._tag !== "Days") return;
    for (const locale of appLocales) {
      const text = accessDaysText(span.first, span.last, locale);
      expect(text).toContain(accessDaysText(span.first, span.first, locale));
      expect(text).toContain(accessDaysText(span.last, span.last, locale));
    }
  });
});

describe("accessChipOf", () => {
  const sameDay = window(pragueMidnight26, fivePm26);
  const chipAt = (now: DateTime.Utc, w = sameDay) =>
    accessChipOf(accessWindowState(now, w.startsAt, w.endsAt), w, now);

  test("before it starts, says from when and how many Prague days away", () => {
    const chip = chipAt(at("2026-11-10T08:00:00Z"));
    expect(chip).toEqual(
      AccessChip.Starts({
        at: pragueMidnight26,
        countdown: { kind: "days", days: 16 },
      })
    );
    expect(chipAt(at("2026-11-25T08:00:00Z"))).toMatchObject({
      countdown: { kind: "tomorrow" },
    });
  });

  test("while it works, ends at a time on the same day", () => {
    expect(chipAt(at("2026-11-26T09:00:00Z"))).toEqual(
      AccessChip.Active({ until: AccessMoment.Time({ at: fivePm26 }) })
    );
  });

  test("while it works across days, ends at a date and time", () => {
    expect(
      chipAt(at("2026-11-26T21:00:00Z"), window(ninePm26, tenAm27))
    ).toEqual(
      AccessChip.Active({ until: AccessMoment.DateTime({ at: tenAm27 }) })
    );
  });

  test("a full day works until the end of that same day", () => {
    const fullDay = window(pragueMidnight26, pragueMidnight27);
    expect(chipAt(at("2026-11-26T09:00:00Z"), fullDay)).toEqual(
      AccessChip.Active({ until: AccessMoment.Time({ at: pragueMidnight27 }) })
    );
    expect(chipAt(at("2026-11-27T09:00:00Z"), fullDay)).toEqual(
      AccessChip.Ended({ at: pragueMidnight27 })
    );
  });

  test("once over, says when it ended", () => {
    expect(chipAt(at("2026-11-27T09:00:00Z"))).toEqual(
      AccessChip.Ended({ at: fivePm26 })
    );
  });

  test("every chip has text in every locale", () => {
    const now = at("2026-11-10T08:00:00Z");
    const chips = [
      accessChipOf(
        AccessWindowState.Upcoming({ startsIn: Duration.hours(1) }),
        sameDay,
        now
      ),
      chipAt(at("2026-11-26T09:00:00Z")),
      chipAt(at("2026-11-26T21:00:00Z"), window(ninePm26, tenAm27)),
      chipAt(at("2026-11-27T09:00:00Z")),
      chipAt(
        at("2026-11-27T09:00:00Z"),
        window(pragueMidnight26, pragueMidnight27)
      ),
    ];
    for (const locale of appLocales) {
      for (const chip of chips) {
        expect(accessChipText(chip, locale).trim()).not.toBe("");
      }
    }
  });
});

describe("accessMomentParts", () => {
  test("on a 24-hour clock a midnight end is 24:00 of the day it closes", () => {
    // cs-CZ writes times on a 24-hour clock where the device doesn't say.
    expect(accessMomentParts(pragueMidnight27, "cs-CZ", "end")).toEqual({
      date: shortDate(fivePm26, "cs-CZ"),
      time: "24:00",
    });
  });

  test("a 12-hour clock keeps its own midnight, on the next day", () => {
    // en-US writes times on a 12-hour clock where the device doesn't say.
    expect(accessMomentParts(pragueMidnight27, "en-US", "end")).toEqual({
      date: shortDate(pragueMidnight27, "en-US"),
      time: formatInstant(pragueMidnight27, "en-US", "time"),
    });
  });

  test("a midnight start is that day's first minute, and other ends keep their time", () => {
    for (const locale of appLocales) {
      expect(accessMomentParts(pragueMidnight27, locale, "start")).toEqual({
        date: shortDate(pragueMidnight27, locale),
        time: formatInstant(pragueMidnight27, locale, "time"),
      });
      expect(accessMomentParts(fivePm26, locale, "end")).toEqual({
        date: shortDate(fivePm26, locale),
        time: formatInstant(fivePm26, locale, "time"),
      });
    }
  });
});
