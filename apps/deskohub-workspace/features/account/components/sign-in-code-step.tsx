"use client";

import { useAtomValue } from "@effect/atom-react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import type { SignInCodeVerification } from "@/features/account/auth-return";
import { SIGN_IN_CODE_LENGTH } from "@/features/account/sign-in-code-request";
import {
  resendCooldownSecondsAtom,
  SIGN_IN_CODE_RESEND_COOLDOWN_MS,
} from "@/features/account/sign-in-code-resend-cooldown";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/shared/components/ui/input-otp";
import { cn } from "@/shared/utils";

type CodeStatus = "idle" | SignInCodeVerification | "verifying";
type ResendStatus = "idle" | "sending" | "sent" | "failed";

type SignInCodeStepProps = {
  readonly locale: Locale;
  readonly email: string;
  /** When the email holding the current code was requested (epoch ms). */
  readonly requestedAt: number;
  readonly verifiedMessage: string;
  readonly verifyCode: (code: string) => Promise<SignInCodeVerification>;
  readonly onVerified: () => void;
  /** Sends a new email; resolves false when the request failed. */
  readonly requestNewEmail: () => Promise<boolean>;
  readonly onUseDifferentEmail?: () => void;
};

const isDeadCode = (status: CodeStatus) =>
  status === "expired" || status === "too-many-attempts";

/**
 * Code entry shared by sign-in and account-deletion re-authentication. The
 * caller renders the heading and the masked-address description.
 */
export function SignInCodeStep({
  locale,
  email,
  requestedAt,
  verifiedMessage,
  verifyCode,
  onVerified,
  requestNewEmail,
  onUseDifferentEmail,
}: SignInCodeStepProps) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<CodeStatus>("idle");
  const [resendStatus, setResendStatus] = useState<ResendStatus>("idle");
  const [shownRequestedAt, setShownRequestedAt] = useState(requestedAt);
  const inputRef = useRef<HTMLInputElement>(null);
  const cooldownSeconds = useAtomValue(
    resendCooldownSecondsAtom(requestedAt + SIGN_IN_CODE_RESEND_COOLDOWN_MS)
  );

  // A new email replaces the code: start the entry over.
  if (shownRequestedAt !== requestedAt) {
    setShownRequestedAt(requestedAt);
    setCode("");
    setStatus("idle");
  }

  const submitCode = async (value: string) => {
    // The disabled input keeps no focus ring while the code is checked.
    inputRef.current?.blur();
    setStatus("verifying");
    const verification = await verifyCode(value);
    setStatus(verification);
    if (verification === "verified") {
      onVerified();
      return;
    }
    setCode("");
    // Refocus once the input is enabled again for the next attempt.
    if (!isDeadCode(verification)) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const sendNewEmail = async () => {
    setResendStatus("sending");
    const sent = await requestNewEmail();
    setResendStatus(sent ? "sent" : "failed");
    if (sent) inputRef.current?.focus();
  };

  const dead = isDeadCode(status);
  const verifying = status === "verifying";
  const verified = status === "verified";
  const invalid = status === "invalid";
  const resendDisabled =
    cooldownSeconds > 0 || resendStatus === "sending" || verifying || verified;

  const statusMessage = {
    idle:
      resendStatus === "sent"
        ? m.accountSignInCodeResent({}, { locale })
        : resendStatus === "failed"
          ? m.accountSignInRequestFailed({}, { locale })
          : null,
    verifying: m.accountSignInCodeVerifying({}, { locale }),
    verified: verifiedMessage,
    invalid: m.accountSignInCodeInvalid({}, { locale }),
    expired: m.accountSignInCodeExpired({}, { locale }),
    "too-many-attempts": m.accountSignInCodeTooManyAttempts({}, { locale }),
    failed: m.accountSignInCodeFailed({}, { locale }),
  }[status];
  const statusTone = {
    idle: resendStatus === "failed" ? "error" : "neutral",
    verifying: "neutral",
    verified: "success",
    invalid: "error",
    expired: "error",
    "too-many-attempts": "error",
    failed: "error",
  }[status];

  return (
    <div className="mt-8">
      <label
        htmlFor="account-sign-in-code"
        className="text-sm font-semibold text-navy-blue"
      >
        {m.accountSignInCodeLabel({}, { locale })}
      </label>
      <InputOTP
        ref={inputRef}
        id="account-sign-in-code"
        autoFocus
        maxLength={SIGN_IN_CODE_LENGTH}
        pattern={REGEXP_ONLY_DIGITS}
        pasteTransformer={(pasted) => pasted.replace(/\D/g, "")}
        value={code}
        onChange={setCode}
        onComplete={submitCode}
        disabled={dead || verifying || verified}
        aria-invalid={invalid}
        aria-describedby="account-sign-in-code-status"
        containerClassName="mt-2 w-full max-w-[22rem] gap-2 sm:gap-3"
      >
        <InputOTPGroup className="flex-1 gap-1.5 sm:gap-2">
          {[0, 1, 2].map((index) => (
            <InputOTPSlot
              key={index}
              index={index}
              invalid={invalid}
              className="w-full"
            />
          ))}
        </InputOTPGroup>
        <InputOTPSeparator />
        <InputOTPGroup className="flex-1 gap-1.5 sm:gap-2">
          {[3, 4, 5].map((index) => (
            <InputOTPSlot
              key={index}
              index={index}
              invalid={invalid}
              className="w-full"
            />
          ))}
        </InputOTPGroup>
      </InputOTP>

      <div
        id="account-sign-in-code-status"
        aria-live="polite"
        className={cn(
          "mt-3 flex min-h-5 items-start gap-2 text-sm leading-5",
          {
            neutral: "text-navy-blue/68",
            success: "text-aquamarine-ink",
            error: "text-red-700",
          }[statusTone]
        )}
      >
        {verifying && (
          <Loader2
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 animate-spin"
          />
        )}
        {verified && (
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        )}
        {statusMessage}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button
          id="account-sign-in-code-resend"
          type="button"
          variant={dead ? "primary" : "secondary"}
          disabled={resendDisabled}
          aria-busy={resendStatus === "sending"}
          onClick={sendNewEmail}
        >
          {resendStatus === "sending" && (
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          )}
          {cooldownSeconds > 0
            ? m.accountSignInCodeResendCooldown(
                { seconds: cooldownSeconds },
                { locale }
              )
            : m.accountSignInCodeResend({}, { locale })}
        </Button>
        {onUseDifferentEmail && (
          <Button
            type="button"
            variant="ghost"
            disabled={verifying || verified}
            className="px-0 underline-offset-4 hover:bg-transparent hover:underline"
            onClick={onUseDifferentEmail}
          >
            {m.accountSignInCodeChangeEmail({}, { locale })}
          </Button>
        )}
      </div>

      <p className="mt-6 border-t border-navy-blue/10 pt-5 text-sm leading-6 text-navy-blue/60">
        {m.accountSignInCodeLinkHint({}, { locale })}
      </p>
    </div>
  );
}
