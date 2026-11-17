import { useAtomValue } from "@effect/atom-react";
import { Clock, Stream } from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import Timer from "lucide-react-native/icons/timer";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import { StyleSheet, View } from "react-native";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { Button } from "../../ui/controls";
import { Dialog } from "../../ui/dialog";
import { Icon } from "../../ui/icon";
import { Text } from "../../ui/text";
import { color, radius, space } from "../../ui/tokens";

/**
 * Where the checkout hold stands: `held` while time remains, `ending` in its
 * last minute, `ended` once the hold has expired.
 */
type HoldPhase = "held" | "ending" | "ended";

export interface HoldStatus {
  /** Whole seconds left, rounded up, so 0 only once the hold has expired. */
  readonly secondsLeft: number;
  readonly phase: HoldPhase;
}

/** The last minute of a hold is shown as ending. */
const endingSeconds = 60;

/**
 * How the hold that expires at `expiresAt` (an ISO instant) stands at
 * `nowMillis`. Seconds round up, so 0:00 shows only at or after expiry; an
 * expiry that doesn't parse counts as ended.
 */
export const holdCountdown = (
  expiresAt: string,
  nowMillis: number
): HoldStatus => {
  const remainingMillis = Date.parse(expiresAt) - nowMillis;
  if (!(remainingMillis > 0)) return { secondsLeft: 0, phase: "ended" };
  const secondsLeft = Math.ceil(remainingMillis / 1000);
  return {
    secondsLeft,
    phase: secondsLeft <= endingSeconds ? "ending" : "held",
  };
};

/** Seconds as the hold timer shows them: `m:ss`. */
export const holdClockText = (secondsLeft: number): string =>
  `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

/** The current time in milliseconds, read again every second while a screen reads it. */
const holdClockTicksAtom = Atom.make(
  Stream.tick("1 second").pipe(Stream.mapEffect(() => Clock.currentTimeMillis))
);

const holdClockAtom = Atom.map(holdClockTicksAtom, (ticks) =>
  AsyncResult.getOrElse(ticks, () => Date.now())
);

/**
 * The hold that expires at `expiresAt`, live: a one-second clock re-renders
 * it while mounted. The time is read as it renders, as well as from the
 * clock, so a chip that mounts while the clock already runs, such as on the
 * next step, doesn't start from the clock's previous tick.
 */
export const useHoldCountdown = (expiresAt: string): HoldStatus =>
  holdCountdown(expiresAt, Math.max(useAtomValue(holdClockAtom), Date.now()));

const phaseLook = {
  held: { chip: undefined, ink: color.navy, icon: Timer },
  ending: { chip: "ending", ink: color.warningInk, icon: Timer },
  ended: { chip: "ended", ink: color.dangerInk, icon: TriangleAlert },
} as const;

/**
 * The hold timer chip for a given `status`: a sunken pill with a timer icon
 * and the time left; amber in the last minute, red with an alert icon at
 * 0:00. `HoldChip` keeps it live.
 */
export function HoldStatusChip({
  status,
  locale,
}: {
  readonly status: HoldStatus;
  readonly locale: AppLocale;
}) {
  const time = holdClockText(status.secondsLeft);
  const look = phaseLook[status.phase];
  return (
    <View
      accessible
      role="timer"
      aria-label={m.booking_hold_chip_label({ time }, { locale })}
      style={[styles.chip, look.chip && styles[look.chip]]}
    >
      <Icon icon={look.icon} size={18} color={look.ink} />
      <Text variant="label" numeric style={{ color: look.ink }}>
        {time}
      </Text>
    </View>
  );
}

/**
 * The app bar's countdown of the checkout hold that expires at `expiresAt`.
 * It only shows the time: the checkout flow owns the hold and expires it.
 */
export function HoldChip({
  expiresAt,
  locale,
}: {
  readonly expiresAt: string;
  readonly locale: AppLocale;
}) {
  return (
    <HoldStatusChip status={useHoldCountdown(expiresAt)} locale={locale} />
  );
}

/**
 * Tells the customer the hold ran out and lets them check the date again,
 * with their choices kept, or leave the booking. Dismissing it checks the
 * date again.
 */
export function HoldEndedDialog({
  visible,
  onCheckDate,
  onLeave,
  locale,
}: {
  readonly visible: boolean;
  readonly onCheckDate: () => void;
  readonly onLeave: () => void;
  readonly locale: AppLocale;
}) {
  return (
    <Dialog
      visible={visible}
      role="alertdialog"
      title={m.booking_hold_ended_title({}, { locale })}
      body={m.booking_hold_ended_body({}, { locale })}
      onDismiss={onCheckDate}
      actions={
        <>
          <Button
            label={m.booking_hold_ended_check_date({}, { locale })}
            onPress={onCheckDate}
          />
          <Button
            label={m.booking_hold_ended_leave({}, { locale })}
            variant="quiet"
            onPress={onLeave}
          />
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: "center",
    backgroundColor: color.sunken,
    borderRadius: radius.pill,
    flexDirection: "row",
    flexShrink: 0,
    gap: 6,
    marginRight: space.xs,
    minHeight: 36,
    paddingLeft: 10,
    paddingRight: space.md,
  },
  ending: {
    backgroundColor: color.warningTint,
    boxShadow: `inset 0 0 0 1.5px ${color.warning}`,
  },
  ended: { backgroundColor: color.dangerTint },
});
