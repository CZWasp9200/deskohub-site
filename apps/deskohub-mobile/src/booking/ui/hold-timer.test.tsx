import { describe, expect, test } from "bun:test";
import {
  act,
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { AppLocaleProvider } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { clientRoot } from "../../testing/client-root";
import { Button } from "../../ui/controls";
import { Dialog } from "../../ui/dialog";
import { Icon } from "../../ui/icon";
import { elementTree, find, flatStyle } from "../../ui/testing/element-tree";
import { Text } from "../../ui/text";
import { color } from "../../ui/tokens";
import {
  HoldChip,
  HoldEndedDialog,
  type HoldStatus,
  HoldStatusChip,
  holdClockText,
  holdCountdown,
  useHoldCountdown,
} from "./hold-timer";

const expiresAt = "2026-11-15T12:10:00.000Z";
const expiry = Date.parse(expiresAt);
const before = (millis: number) => expiry - millis;

describe("holdCountdown", () => {
  test.each([
    ["more than a minute", 61_000, { secondsLeft: 61, phase: "held" }],
    ["exactly a minute", 60_000, { secondsLeft: 60, phase: "ending" }],
    ["under a minute", 59_000, { secondsLeft: 59, phase: "ending" }],
    ["at expiry", 0, { secondsLeft: 0, phase: "ended" }],
    ["past expiry", -5_000, { secondsLeft: 0, phase: "ended" }],
  ] as const)("with %s left", (_, millisLeft, expected) => {
    expect(holdCountdown(expiresAt, before(millisLeft))).toEqual(expected);
  });

  test("rounds a part second up, so the last moment still shows 0:01", () => {
    expect(holdCountdown(expiresAt, before(1))).toEqual({
      secondsLeft: 1,
      phase: "ending",
    });
    expect(holdCountdown(expiresAt, before(60_001))).toEqual({
      secondsLeft: 61,
      phase: "held",
    });
  });

  test("an expiry that doesn't parse has ended", () => {
    expect(holdCountdown("not a time", before(60_000))).toEqual({
      secondsLeft: 0,
      phase: "ended",
    });
  });
});

describe("holdClockText", () => {
  test.each([
    [597, "9:57"],
    [60, "1:00"],
    [58, "0:58"],
    [5, "0:05"],
    [0, "0:00"],
    [600, "10:00"],
  ] as const)("shows %i seconds as %s", (seconds, text) => {
    expect(holdClockText(seconds)).toBe(text);
  });
});

const chip = (status: HoldStatus) =>
  elementTree(HoldStatusChip, { status, locale: "en-US" }) as ReactElement<{
    role?: string;
    "aria-label"?: string;
    style?: unknown;
    children?: ReactNode;
  }>;

const chipIcon = (status: HoldStatus) =>
  find<Parameters<typeof Icon>[0]>(chip(status), Icon)?.props;

describe("HoldStatusChip", () => {
  test("is a timer named by the time left", () => {
    const props = chip({ secondsLeft: 597, phase: "held" }).props;
    expect(props.role).toBe("timer");
    expect(props["aria-label"]).toBe(
      m.booking_hold_chip_label({ time: "9:57" }, { locale: "en-US" })
    );
    expect(
      find<{ children?: ReactNode; numeric?: boolean }>(
        chip({ secondsLeft: 597, phase: "held" }),
        Text
      )?.props
    ).toMatchObject({ children: "9:57", numeric: true });
  });

  test("a held chip is sunken navy with a timer icon", () => {
    const status = { secondsLeft: 597, phase: "held" } as const;
    expect(flatStyle(chip(status).props.style)).toMatchObject({
      backgroundColor: color.sunken,
    });
    expect(flatStyle(chip(status).props.style).boxShadow).toBeUndefined();
    expect(chipIcon(status)?.color).toBe(color.navy);
  });

  test("an ending chip turns amber with an amber ring", () => {
    const status = { secondsLeft: 58, phase: "ending" } as const;
    const style = flatStyle(chip(status).props.style);
    expect(style.backgroundColor).toBe(color.warningTint);
    expect(String(style.boxShadow)).toContain(color.warning);
    expect(chipIcon(status)?.color).toBe(color.warningInk);
  });

  test("an ended chip turns red with an alert icon instead of the timer", () => {
    const ended = { secondsLeft: 0, phase: "ended" } as const;
    const held = { secondsLeft: 597, phase: "held" } as const;
    expect(flatStyle(chip(ended).props.style).backgroundColor).toBe(
      color.dangerTint
    );
    expect(chipIcon(ended)?.color).toBe(color.dangerInk);
    expect(chipIcon(ended)?.icon).not.toBe(chipIcon(held)?.icon);
  });
});

const dialogFor = (handlers: {
  onCheckDate: () => void;
  onLeave: () => void;
}) =>
  elementTree(HoldEndedDialog, {
    visible: true,
    locale: "en-US",
    ...handlers,
  }) as ReactElement<Parameters<typeof Dialog>[0]>;

const actions = (dialog: ReactElement<Parameters<typeof Dialog>[0]>) =>
  Children.toArray(
    (dialog.props.actions as ReactElement<{ children?: ReactNode }>).props
      .children
  )
    .filter(
      (action): action is ReactElement<Parameters<typeof Button>[0]> =>
        isValidElement(action) && action.type === Button
    )
    .map((button) => button.props);

describe("HoldEndedDialog", () => {
  const onCheckDate = () => undefined;
  const onLeave = () => undefined;

  test("is an alert dialog that dismisses to checking the date again", () => {
    const dialog = dialogFor({ onCheckDate, onLeave });
    expect(dialog.type).toBe(Dialog);
    expect(dialog.props.role).toBe("alertdialog");
    expect(dialog.props.visible).toBe(true);
    expect(dialog.props.onDismiss).toBe(onCheckDate);
  });

  test("leads with the primary check-the-date action, then a quiet leave", () => {
    expect(
      actions(dialogFor({ onCheckDate, onLeave })).map(
        ({ onPress, variant }) => [onPress, variant ?? "primary"]
      )
    ).toEqual([
      [onCheckDate, "primary"],
      [onLeave, "quiet"],
    ]);
  });
});

describe("useHoldCountdown", () => {
  const { render } = clientRoot();
  // Real time passes inside act, so the clock's re-renders land in it.
  const pass = (millis: number) =>
    act(() => new Promise((resolve) => setTimeout(resolve, millis)));

  test("is right on the first render and counts down each second", async () => {
    const seen: Array<HoldStatus> = [];
    const expiresAt = new Date(Date.now() + 65_000).toISOString();
    function Probe() {
      seen.push(useHoldCountdown(expiresAt));
      return null;
    }
    await render(
      <AppLocaleProvider locale="en-US">
        <Probe />
      </AppLocaleProvider>
    );
    expect(seen[0]?.phase).toBe("held");
    expect(seen[0]?.secondsLeft).toBeOneOf([65, 64]);

    // At least two ticks, however slowly a loaded machine runs timers.
    const deadline = Date.now() + 10_000;
    while ((seen.at(-1)?.secondsLeft ?? 65) > 63 && Date.now() < deadline) {
      await pass(100);
    }
    const last = seen.at(-1);
    expect(last?.secondsLeft).toBeLessThanOrEqual(63);
    // Never behind the time: the last render shows at least what's left now.
    expect(last?.secondsLeft).toBeGreaterThanOrEqual(
      holdCountdown(expiresAt, Date.now()).secondsLeft
    );
    await render(null);
  });

  test("a countdown mounted while the clock already runs starts from now", async () => {
    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    function Running() {
      useHoldCountdown(expiresAt);
      return null;
    }
    let first: HoldStatus | undefined;
    let fresh = "";
    function Mounted() {
      const status = useHoldCountdown(fresh);
      first ??= status;
      return null;
    }
    await render(<Running />);
    // Between the running clock's ticks, a new hold of exactly 30 seconds.
    await pass(1_500);
    fresh = new Date(Date.now() + 30_000).toISOString();
    await render(
      <>
        <Running />
        <Mounted />
      </>
    );
    expect(first?.secondsLeft).toBeLessThanOrEqual(30);
    expect(first?.secondsLeft).toBeGreaterThanOrEqual(29);
    await render(null);
  });

  test("a hold that has just expired mounts as ended", async () => {
    const expiresAt = new Date(Date.now() - 1).toISOString();
    let first: HoldStatus | undefined;
    function Mounted() {
      const status = useHoldCountdown(expiresAt);
      first ??= status;
      return null;
    }
    await render(<Mounted />);
    expect(first).toEqual({ secondsLeft: 0, phase: "ended" });
    await render(null);
  });

  test("HoldChip draws the live countdown of its expiry", async () => {
    let drawn: ReactElement<Parameters<typeof HoldStatusChip>[0]> | undefined;
    const expiresAt = new Date(Date.now() + 30_000).toISOString();
    function Probe() {
      // The chip runs here, with its clock hook; the chip it draws is read.
      drawn = HoldChip({ expiresAt, locale: "en-US" }) as typeof drawn;
      return null;
    }
    await render(<Probe />);
    expect(drawn?.type).toBe(HoldStatusChip);
    expect(drawn?.props.status.phase).toBe("ending");
    expect(drawn?.props.status.secondsLeft).toBeOneOf([30, 29]);
    expect(drawn?.props.locale).toBe("en-US");
    await render(null);
  });
});
