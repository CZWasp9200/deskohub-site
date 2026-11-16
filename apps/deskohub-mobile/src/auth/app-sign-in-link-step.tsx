import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { AppSignInLayout } from "./app-sign-in-layout";
import { SignInResend } from "./sign-in-resend";
import {
  SignInStepMessage,
  type SignInStepNotice,
} from "./sign-in-step-message";

/**
 * The sign-in page the app opens, after an email that carries only a link
 * (sign-in codes off): what to open and where, and the wait for another
 * link. It has no bottom action; the next step is in the email.
 */
export function AppSignInLinkStep({
  email,
  notice,
  resendAvailableAt,
  onResend,
  resending,
  onUseDifferentEmail,
}: {
  readonly email: string;
  readonly notice: SignInStepNotice | undefined;
  /** Epoch ms from which another email may be sent. */
  readonly resendAvailableAt: number;
  readonly onResend: () => void;
  readonly resending: boolean;
  readonly onUseDifferentEmail: () => void;
}) {
  const locale = useAppLocale();
  return (
    <AppSignInLayout
      title={m.signin_sent_title({}, { locale })}
      instructions={m.signin_sent_link_body({ email }, { locale })}
      onUseDifferentEmail={onUseDifferentEmail}
      useDifferentEmailDisabled={resending}
    >
      <SignInResend
        availableAt={resendAvailableAt}
        what="link"
        onResend={onResend}
        busy={resending}
      />
      <SignInStepMessage notice={notice} />
    </AppSignInLayout>
  );
}
