import { describe, expect, test } from "bun:test";
import { DateTime, Duration } from "effect";
import { appLocales } from "../../i18n/app-locale";
import { AccessWindowState, accessWindowState } from "./access-window";
import {
  AccessChip,
  AccessMoment,
  AccessWindowSpan,
  accessChipOf,
  accessChipText,
  accessDaysText,
  accessWindowSpanOf,
} from "./access-window-text";

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

  test("a full day works until the end of that day, never a midnight time", () => {
    const fullDay = window(pragueMidnight26, pragueMidnight27);
    const active = chipAt(at("2026-11-26T09:00:00Z"), fullDay);
    const ended = chipAt(at("2026-11-27T09:00:00Z"), fullDay);
    expect(active._tag === "Active" && active.until._tag).toBe("Day");
    expect(ended._tag === "Ended" && ended.at._tag).toBe("Day");
  });

  test("once over, says when it ended", () => {
    expect(chipAt(at("2026-11-27T09:00:00Z"))).toEqual(
      AccessChip.Ended({ at: AccessMoment.DateTime({ at: fivePm26 }) })
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
