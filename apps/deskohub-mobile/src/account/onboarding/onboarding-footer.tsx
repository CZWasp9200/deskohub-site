import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import { StyleSheet, View } from "react-native";
import type { CustomerViewError } from "../../customer-api/customer-view-error";
import { sharedViewErrorMessage } from "../../customer-api/customer-view-error-message";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { ActionFooter } from "../../ui/action-footer";
import { Button } from "../../ui/controls";
import { useLiveRegionAnnouncement } from "../../ui/live-announcement";
import { Notice } from "../../ui/notice";
import { idleLiveRegionLayout } from "../../ui/notice-presentation";
import { Text } from "../../ui/text";
import { space } from "../../ui/tokens";
import type { CompletionTextField } from "../profile/profile-draft";
import { profileFooterView } from "../profile/profile-footer-view";
import type { ProfileSubmitState } from "../profile/profile-save";
import type { OnboardingStep } from "./onboarding-model";
import { OnboardingStepProgress } from "./onboarding-step-head";

const fixFieldsMessage = (
  step: OnboardingStep,
  count: number,
  locale: AppLocale
) =>
  ({
    "about-you": () =>
      count === 1
        ? m.onboarding_fix_one_field_continue({}, { locale })
        : m.onboarding_fix_fields_continue({ count }, { locale }),
    billing: () =>
      count === 1
        ? m.onboarding_fix_one_field_create({}, { locale })
        : m.onboarding_fix_fields_create({ count }, { locale }),
  })[step]();

// A request that never got an answer says what didn't happen (board 08b);
// other failures read as on every screen.
const failureMessage = (error: CustomerViewError, locale: AppLocale) => {
  if (error._tag === "LinkRequired")
    return m.profile_link_required({}, { locale });
  if (
    error._tag === "Unavailable" ||
    error._tag === "TimedOut" ||
    error._tag === "Unexpected"
  )
    return m.onboarding_create_failed({}, { locale });
  return (
    sharedViewErrorMessage(error, locale) ??
    m.onboarding_create_failed({}, { locale })
  );
};

/**
 * An onboarding step's sticky footer, above the keyboard with the screen's
 * keyboard view (boards 06 to 08): the step's button, the count of fields
 * to fix above it, and, when the submit failed, the failure next to a Try
 * again that submits the kept answers again. At wide widths the footer
 * also shows the current step.
 */
export function OnboardingFooter({
  step,
  state,
  shownFields,
  label,
  busyLabel,
  onPress,
  locale,
  wide,
}: {
  readonly step: OnboardingStep;
  readonly state: ProfileSubmitState;
  /** The fields on this step, which the count covers. */
  readonly shownFields: ReadonlyArray<CompletionTextField>;
  readonly label: string;
  readonly busyLabel: string;
  readonly onPress: () => void;
  readonly locale: AppLocale;
  readonly wide: boolean;
}) {
  // Nothing to compare against a saved profile, so the draft always counts
  // as unsaved. Fields to fix on the other step say nothing here: the flow
  // takes the customer there.
  const { message } = profileFooterView(state, true, shownFields);
  const failed = message?.kind === "failed" ? message.error : undefined;
  const busy = state._tag === "Submitting";
  const retryLabel = m.account_retry({}, { locale });
  const idleLabel = failed === undefined ? label : retryLabel;
  const buttonLabel = busy ? busyLabel : idleLabel;
  const fieldsMessage =
    message?.kind === "fix-fields"
      ? fixFieldsMessage(step, message.count, locale)
      : undefined;
  // Kept mounted so assistive tech announces it.
  const failure = (
    <Notice
      tone={failed?._tag === "Unconfirmed" ? "warning" : "error"}
      message={
        failed === undefined ? undefined : failureMessage(failed, locale)
      }
    />
  );
  return (
    <ActionFooter
      message={wide ? undefined : fieldsMessage}
      messageTone="error"
      aside={
        wide ? (
          <>
            {failed === undefined && fieldsMessage === undefined && (
              <OnboardingStepProgress step={step} locale={locale} wide />
            )}
            <FieldErrorStatus message={fieldsMessage} />
            {failure}
          </>
        ) : undefined
      }
    >
      <View style={[styles.controls, wide && styles.wideControls]}>
        {!wide && failure}
        <Button
          label={buttonLabel}
          icon={failed === undefined ? undefined : RotateCcw}
          busy={busy}
          onPress={onPress}
        />
      </View>
    </ActionFooter>
  );
}

function FieldErrorStatus({
  message,
}: {
  readonly message: string | undefined;
}) {
  useLiveRegionAnnouncement(message, "polite");
  return (
    <Text
      role="status"
      aria-live="polite"
      accessibilityLiveRegion="polite"
      variant="hintStrong"
      tone="danger"
      style={message === undefined ? idleLiveRegionLayout : undefined}
    >
      {message ?? ""}
    </Text>
  );
}

const styles = StyleSheet.create({
  controls: { gap: space.sm },
  wideControls: { minWidth: 200 },
});
