"use client";

import { useState } from "react";
import type {
  AuthReturnLifecycle,
  SignInEmailFailure,
} from "@/features/account/auth-return";
import { SignInCodeStep } from "@/features/account/components/sign-in-code-step";
import { signInEmailFailureMessage } from "@/features/account/components/sign-in-email-failure-message";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { maskEmailAddress } from "@/shared/utils";

type DeleteAccountReauthStepProps = {
  readonly email: string;
  readonly locale: Locale;
  readonly authReturn: AuthReturnLifecycle;
  /** Runs once a typed code has created a fresh session. */
  readonly onReauthenticated: () => void;
};

/**
 * The deletion dialog's re-authentication step: send a fresh magic link and,
 * when the email also carries a code, let the customer type it in place.
 */
export function DeleteAccountReauthStep({
  email,
  locale,
  authReturn,
  onReauthenticated,
}: DeleteAccountReauthStepProps) {
  const [linkSent, setLinkSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<SignInEmailFailure | null>(null);
  const [codeRequestedAt, setCodeRequestedAt] = useState<number | null>(null);

  // A code-carrying email opens the code step in place. Without a code, as
  // when codes are switched off between two emails, only the link signs in.
  const sendReauthEmail = async () => {
    const result = await authReturn.sendSignInEmail(email);
    if (result.status !== "sent") {
      return result.status === "failed" ? result.reason : result.status;
    }
    setCodeRequestedAt(result.signInCode ? Date.now() : null);
    setLinkSent(!result.signInCode);
    return result.status;
  };

  const requestReauthLink = async () => {
    setFailure(null);
    setSending(true);
    const outcome = await sendReauthEmail();
    setFailure(outcome === "sent" || outcome === "cancelled" ? null : outcome);
    setSending(false);
  };

  if (codeRequestedAt !== null) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>
            {m.accountDeletionReauthCodeTitle({}, { locale })}
          </DialogTitle>
          <DialogDescription id="delete-account-dialog-description">
            {m.accountSignInCodeBody(
              { email: maskEmailAddress(email) },
              { locale }
            )}
          </DialogDescription>
        </DialogHeader>
        <SignInCodeStep
          locale={locale}
          requestedAt={codeRequestedAt}
          verifiedMessage={m.accountDeletionReauthCodeVerified({}, { locale })}
          verifyCode={(code) => authReturn.verifySignInCode(email, code)}
          onVerified={onReauthenticated}
          requestNewEmail={sendReauthEmail}
        />
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {m.accountDeletionReauthTitle({}, { locale })}
        </DialogTitle>
        <DialogDescription id="delete-account-dialog-description">
          {m.accountDeletionReauthBody({}, { locale })}
        </DialogDescription>
      </DialogHeader>
      <div
        aria-live={failure ? "assertive" : "polite"}
        className="mt-4 min-h-5 text-sm text-navy-blue/78"
        role={failure ? "alert" : undefined}
      >
        {failure && signInEmailFailureMessage(failure, locale)}
        {!failure &&
          linkSent &&
          m.accountDeletionReauthLinkSent({}, { locale })}
      </div>
      <DialogFooter>
        <Button
          id="delete-account-reauth-send"
          type="button"
          disabled={sending || linkSent}
          onClick={requestReauthLink}
        >
          {m.accountDeletionReauthSendLink({}, { locale })}
        </Button>
      </DialogFooter>
    </>
  );
}
