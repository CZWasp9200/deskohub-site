import { StyleSheet, View } from "react-native";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { Text } from "../../ui/text";
import { color, space } from "../../ui/tokens";
import { type OnboardingStep, onboardingSteps } from "./onboarding-model";

/**
 * The step title and optional intro. Compact screens show progress here.
 */
export function OnboardingStepHead({
  step,
  title,
  intro,
  locale,
  wide,
}: {
  readonly step: OnboardingStep;
  readonly title: string;
  readonly intro?: string;
  readonly locale: AppLocale;
  readonly wide: boolean;
}) {
  return (
    <View style={[styles.head, wide && styles.wideHead]}>
      {!wide && <OnboardingStepProgress step={step} locale={locale} />}
      <Text role="heading" variant={wide ? "display" : "titleLarge"}>
        {title}
      </Text>
      {intro !== undefined && (
        <Text variant={wide ? "body" : "lead"} tone="muted">
          {intro}
        </Text>
      )}
    </View>
  );
}

export function OnboardingStepProgress({
  step,
  locale,
  wide = false,
}: {
  readonly step: OnboardingStep;
  readonly locale: AppLocale;
  readonly wide?: boolean;
}) {
  const current = onboardingSteps.indexOf(step);
  return (
    <View style={styles.head}>
      <View aria-hidden style={[styles.bars, wide && styles.footerBars]}>
        {onboardingSteps.map((each, index) => (
          <View
            key={each}
            style={[styles.bar, index <= current && styles.reached]}
          />
        ))}
      </View>
      <Text variant={wide ? "hintStrong" : "caption"} tone="muted">
        {m.onboarding_step(
          {
            current: String(current + 1),
            total: String(onboardingSteps.length),
          },
          { locale }
        )}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { gap: space.sm },
  wideHead: { paddingTop: space.sm, paddingBottom: space.md },
  bars: { flexDirection: "row", gap: 6, width: 120 },
  footerBars: { gap: space.xs, width: 84, maxWidth: "100%" },
  bar: {
    backgroundColor: color.disabled,
    borderRadius: 2,
    flex: 1,
    height: 4,
  },
  reached: { backgroundColor: color.action },
});
