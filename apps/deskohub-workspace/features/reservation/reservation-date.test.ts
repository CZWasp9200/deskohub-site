import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import { isOpenOnCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

const prague = (local: string) =>
  Temporal.PlainDateTime.from(local)
    .toZonedDateTime(workspaceSiteConstants.location.timeZone)
    .toInstant();

const interval = (startsAt: string, endsAt: string) => ({
  startsAt: prague(startsAt),
  endsAt: prague(endsAt),
});

describe("isOpenOnCurrentWorkspaceDate", () => {
  test("holds from the start of the Prague date an interval starts on until it ends", () => {
    const evening = interval("2099-07-30T18:00", "2099-07-30T22:00");

    expect(
      isOpenOnCurrentWorkspaceDate(evening, prague("2099-07-30T00:00"))
    ).toBe(true);
    expect(
      isOpenOnCurrentWorkspaceDate(evening, prague("2099-07-30T21:59"))
    ).toBe(true);
    expect(
      isOpenOnCurrentWorkspaceDate(evening, prague("2099-07-29T23:59"))
    ).toBe(false);
  });

  test("ends exactly at the interval's end", () => {
    const morning = interval("2099-07-30T08:00", "2099-07-30T09:00");

    expect(
      isOpenOnCurrentWorkspaceDate(morning, prague("2099-07-30T09:00"))
    ).toBe(false);
  });

  test("keeps an overnight interval open on the next Prague date until it ends", () => {
    const overnight = interval("2099-07-30T22:00", "2099-07-31T06:00");

    expect(
      isOpenOnCurrentWorkspaceDate(overnight, prague("2099-07-31T05:00"))
    ).toBe(true);
    expect(
      isOpenOnCurrentWorkspaceDate(overnight, prague("2099-07-31T06:00"))
    ).toBe(false);
  });

  test("dates by the Prague calendar across both clock changes, not by UTC", () => {
    // 2099-03-29 and 2099-10-25 are the transition Sundays in Prague: just
    // after midnight local time it is still the previous day in UTC.
    for (const day of ["2099-03-29", "2099-10-25"]) {
      const sameDay = interval(`${day}T20:00`, `${day}T23:00`);
      expect(
        isOpenOnCurrentWorkspaceDate(sameDay, prague(`${day}T00:30`))
      ).toBe(true);
      const next = Temporal.PlainDate.from(day).add({ days: 1 });
      const nextDay = interval(`${next}T00:30`, `${next}T02:00`);
      expect(
        isOpenOnCurrentWorkspaceDate(nextDay, prague(`${day}T23:30`))
      ).toBe(false);
    }
  });
});
