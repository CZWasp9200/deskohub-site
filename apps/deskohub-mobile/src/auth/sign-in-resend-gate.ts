import { SIGN_IN_EMAIL_RESEND_COOLDOWN_MS } from "@deskohub/workspace-customer-api/sign-in-email";
import { DateTime, Option } from "effect";

/**
 * Epoch ms from which the page offers another sign-in email to the same
 * address: the page's cooldown after the send, or the server's next accepted
 * send if that is later. After a wrong code or too many wrong codes the
 * cooldown is waived and only the server's instant gates; with none the
 * email is available again at once.
 */
export const signInResendAvailableAt = ({
  sentAt,
  nextSignInEmailAt,
  cooldownWaived,
}: {
  /** `SentSignInEmail.sentAt`. */
  readonly sentAt: number;
  /** The latest known server instant. */
  readonly nextSignInEmailAt: Option.Option<DateTime.Utc>;
  /** After a wrong code or too many wrong codes the UI cooldown is waived; only the server instant gates. */
  readonly cooldownWaived: boolean;
}): number => {
  const serverAt = Option.map(nextSignInEmailAt, DateTime.toEpochMillis);
  return cooldownWaived
    ? Option.getOrElse(serverAt, () => sentAt)
    : Math.max(
        sentAt + SIGN_IN_EMAIL_RESEND_COOLDOWN_MS,
        Option.getOrElse(serverAt, () => Number.NEGATIVE_INFINITY)
      );
};
