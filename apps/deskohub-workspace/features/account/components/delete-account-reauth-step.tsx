"use client";

import { useState } from "react";
import {
  type AuthReturnLifecycle,
  hasIssuedSignInCode,
} from "@/features/account/auth-return";
import { SignInCodeStep } from "@/features/account/components/sign-in-code-step";
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
  const [failed, setFailed] = useState(false);
  const [codeRequestedAt, setCodeRequestedAt] = useState<number | null>(null);

  // Resolves whether the email went out; a code-carrying email opens the code step.
  const sendReauthEmail = async () => {
    try {
      const result = await authReturn.sendMagicLink(email);
      if (result.error) return false;
      if (hasIssuedSignInCode(result)) setCodeRequestedAt(Date.now());
      else setLinkSent(true);
      return true;
    } catch {
      return false;
    }
  };

  const requestReauthLink = async () => {
    setFailed(false);
    setSending(true);
    const sent = await sendReauthEmail();
    setFailed(!sent);
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
          email={email}
          requestedAt={codeRequestedAt}
          verifiedMessage={m.accountDeletionReauthCodeVerified({}, { locale })}
          verifyCode={(code) => authReturn.verifyCode(email, code)}
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
        aria-live={failed ? "assertive" : "polite"}
        className="mt-4 min-h-5 text-sm text-navy-blue/78"
        role={failed ? "alert" : undefined}
      >
        {failed && m.accountSignInRequestFailed({}, { locale })}
        {!failed && linkSent && m.accountDeletionReauthLinkSent({}, { locale })}
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
