import { resendCooldownSecondsAtom } from "@deskohub/workspace-customer-api/sign-in-email";
import { useAtomValue } from "@effect/atom-react";
import Clock from "lucide-react-native/icons/clock";
import { StyleSheet, View } from "react-native";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { Button } from "../ui/controls";
import { countdownClock } from "../ui/countdown-clock";
import { Icon } from "../ui/icon";
import { Text } from "../ui/text";
import { color, space } from "../ui/tokens";

/**
 * Another sign-in email for the same address: a countdown until
 * `availableAt` (epoch ms), then a text action that sends it. `what` names
 * what the email carries. With `countdownOnly`, the action stays with the
 * page's primary button and only the wait is shown.
 */
export function SignInResend({
  availableAt,
  what,
  onResend,
  busy,
  disabled = false,
  countdownOnly = false,
}: {
  readonly availableAt: number;
  readonly what: "code" | "link";
  readonly onResend: () => void;
  readonly busy: boolean;
  readonly disabled?: boolean;
  readonly countdownOnly?: boolean;
}) {
  const locale = useAppLocale();
  const seconds = useAtomValue(resendCooldownSecondsAtom(availableAt));
  if (seconds > 0) {
    const time = countdownClock(seconds);
    return (
      <View role="timer" style={styles.countdown}>
        <Icon icon={Clock} size={16} color={color.ink2} />
        <Text variant="hint" numeric>
          {what === "code"
            ? m.signin_resend_code_in({ time }, { locale })
            : m.signin_resend_link_in({ time }, { locale })}
        </Text>
      </View>
    );
  }
  if (countdownOnly) return null;
  return (
    <View style={styles.action}>
      <Button
        variant="text"
        width="content"
        label={
          what === "code"
            ? m.signin_resend_code({}, { locale })
            : m.signin_resend_link({}, { locale })
        }
        onPress={onResend}
        busy={busy}
        disabled={disabled}
      />
    </View>
  );
}

/** The seconds left on the resend wait that ends at `availableAt`. */
export const useResendSecondsLeft = (availableAt: number) =>
  useAtomValue(resendCooldownSecondsAtom(availableAt));

const styles = StyleSheet.create({
  countdown: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minHeight: space.xxl,
  },
  // The text button's label lines up with the content's left edge.
  action: { alignItems: "flex-start", marginLeft: -space.lg },
});
