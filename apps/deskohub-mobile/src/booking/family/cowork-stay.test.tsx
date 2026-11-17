import { describe, expect, mock, test } from "bun:test";
import type {
  CustomerBookingSelection,
  CustomerCoworkStay,
} from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import {
  elementTree,
  find,
  type HostProps,
  hostTree,
} from "../../ui/testing/element-tree";
import { bookingSummaryParts } from "../ui/booking-summary";
import { OvernightStayTimes } from "../ui/overnight-stay-times";
import { CoworkDateHeading, CoworkStayTimes } from "./cowork-stay";

// Not the sample noon-to-noon, so the times shown are the ones passed.
const overnightStay = { startTime: "11:00", endTime: "10:00" };

const heading = (offered: boolean, stay: CustomerCoworkStay = "day") => {
  const onStayChange = mock((_stay: CustomerCoworkStay) => undefined);
  const tree = hostTree(
    elementTree(CoworkDateHeading, {
      locale: "en-US",
      overnightStay: offered ? overnightStay : undefined,
      stay,
      onStayChange,
    })
  );
  const control = find(tree, "Pressable")?.props as HostProps | undefined;
  return { control, onStayChange };
};

describe("CoworkDateHeading", () => {
  test("has no switch while no overnight stay is offered", () => {
    expect(heading(false).control).toBeUndefined();
  });

  test("an offered stay draws one switch, off for a day", () => {
    const { control } = heading(true);
    expect(control?.role).toBe("switch");
    expect(control?.["aria-label"]).toEqual(expect.any(String));
    expect(control?.["aria-checked"]).toBe(false);
    expect(heading(true, "overnight").control?.["aria-checked"]).toBe(true);
  });

  test("turning it on asks for the overnight stay, off for the day", () => {
    const off = heading(true, "day");
    ((off.control as HostProps).onPress as () => void)();
    expect(off.onStayChange).toHaveBeenCalledWith("overnight");
    const on = heading(true, "overnight");
    ((on.control as HostProps).onPress as () => void)();
    expect(on.onStayChange).toHaveBeenCalledWith("day");
  });
});

const reservedDesk = (stay?: CustomerCoworkStay): CustomerBookingSelection => ({
  family: "cowork",
  date: "2026-11-23",
  tier: "reserved-desk",
  ...(stay === undefined ? {} : { stay }),
});

const times = (
  selection: Option.Option<CustomerBookingSelection>,
  offered = true
) =>
  elementTree(CoworkStayTimes, {
    locale: "en-US",
    overnightStay: offered ? overnightStay : undefined,
    selection,
  });

describe("CoworkStayTimes", () => {
  test("an overnight selection shows its times as the summaries word them", () => {
    const selection = reservedDesk("overnight");
    const line = find(times(Option.some(selection)), OvernightStayTimes);
    expect(line?.props.times).toBe(
      bookingSummaryParts(selection, "en-US", overnightStay).title
    );
  });

  test("nothing for a day, before a date, or without an offered stay", () => {
    expect(times(Option.some(reservedDesk()))).toBeNull();
    expect(times(Option.none())).toBeNull();
    expect(times(Option.some(reservedDesk("overnight")), false)).toBeNull();
  });
});
