import { StyleSheet, View } from "react-native";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { Text } from "../../ui/text";
import { color, space } from "../../ui/tokens";
import { type OnboardingStep, onboardingSteps } from "./onboarding-model";

/**
 * The top of an onboarding step (boards 06 and 07): a short bar per step,
 * orange up to this one, the step counter, the step's title and, when the
 * board has one, its intro line.
 */
export function OnboardingStepHead({
  step,
  title,
  intro,
  locale,
}: {
  readonly step: OnboardingStep;
  readonly title: string;
  readonly intro?: string;
  readonly locale: AppLocale;
}) {
  const current = onboardingSteps.indexOf(step);
  return (
    <View style={styles.head}>
      <View aria-hidden style={styles.bars}>
        {onboardingSteps.map((each, index) => (
          <View
            key={each}
            style={[styles.bar, index <= current && styles.reached]}
          />
        ))}
      </View>
      <Text variant="caption" tone="muted">
        {m.onboarding_step(
          {
            current: String(current + 1),
            total: String(onboardingSteps.length),
          },
          { locale }
        )}
      </Text>
      <Text role="heading" variant="titleLarge">
        {title}
      </Text>
      {intro !== undefined && (
        <Text variant="lead" tone="muted">
          {intro}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { gap: space.sm },
  bars: { flexDirection: "row", gap: 6, width: 120 },
  bar: {
    backgroundColor: color.disabled,
    borderRadius: 2,
    flex: 1,
    height: 4,
  },
  reached: { backgroundColor: color.action },
});
