import Check from "lucide-react-native/icons/check";
import { StyleSheet, View } from "react-native";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { Icon } from "../../ui/icon";
import { shrinkToFitLine } from "../../ui/shrink-to-fit";
import { Text } from "../../ui/text";
import { color, space } from "../../ui/tokens";

/** A step of the booking flow, in order. */
export type BookingStep = "choose" | "details" | "pay";

const steps: ReadonlyArray<BookingStep> = ["choose", "details", "pay"];

const stepName = (step: BookingStep, locale: AppLocale) =>
  ({
    choose: m.booking_steps_choose({}, { locale }),
    details: m.booking_steps_details({}, { locale }),
    pay: m.booking_steps_pay({}, { locale }),
  })[step];

/**
 * The booking flow's progress under the app bar: a segment per step, orange
 * up to the `current` one, with a check on the steps done. `raised` draws a
 * hairline and a short fade under it while the body scrolls beneath, so a
 * cut line reads as scrolling. Assistive tech hears the step and its number.
 */
export function BookingSteps({
  current,
  raised = false,
  locale,
}: {
  readonly current: BookingStep;
  readonly raised?: boolean;
  readonly locale: AppLocale;
}) {
  const currentIndex = steps.indexOf(current);
  return (
    <View
      accessible
      role="group"
      aria-label={m.booking_steps_progress(
        {
          current: String(currentIndex + 1),
          total: String(steps.length),
          step: stepName(current, locale),
        },
        { locale }
      )}
      style={[styles.steps, raised && styles.raised]}
    >
      {steps.map((step, index) => {
        const done = index < currentIndex;
        const reached = index <= currentIndex;
        return (
          <View key={step} aria-hidden style={styles.step}>
            <View style={[styles.segment, reached && styles.reachedSegment]} />
            <View style={styles.name}>
              {done && <Icon icon={Check} size={14} color={color.action} />}
              <Text
                variant="badge"
                tone={index === currentIndex ? "default" : "muted"}
                {...shrinkToFitLine}
                style={styles.nameText}
              >
                {stepName(step, locale)}
              </Text>
            </View>
          </View>
        );
      })}
      {raised && <View pointerEvents="none" style={styles.fade} />}
    </View>
  );
}

const styles = StyleSheet.create({
  steps: {
    backgroundColor: color.paper,
    flexDirection: "row",
    gap: 6,
    paddingBottom: space.md,
    paddingHorizontal: space.gutter,
    position: "relative",
    zIndex: 3,
  },
  raised: { boxShadow: `0 1px 0 ${color.line}` },
  fade: {
    backgroundImage: `linear-gradient(${color.paper}, rgba(248, 245, 239, 0))`,
    height: 20,
    left: 0,
    position: "absolute",
    right: 0,
    top: "100%",
    marginTop: 1,
  },
  step: { flex: 1, gap: 6, minWidth: 0 },
  segment: { backgroundColor: color.disabled, borderRadius: 2, height: 4 },
  reachedSegment: { backgroundColor: color.action },
  name: { alignItems: "center", flexDirection: "row", gap: space.xs },
  nameText: { flexShrink: 1 },
});
