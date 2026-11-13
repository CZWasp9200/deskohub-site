"use client";

import { MailCheck } from "lucide-react";
import { type FormEvent, useState } from "react";
import { authClient } from "@/features/account/auth.client";
import { LocalizedLink, m } from "@/features/i18n";
import { getLocalizedHref } from "@/features/i18n/utils/locale-url";
import { useLocale } from "@/features/i18n/utils/use-locale";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

type SignInFormProps = {
  /** Same-site path to open after signing in, without the locale prefix. */
  readonly returnPath: string;
  /** True when the customer arrived from an expired or used sign-in link. */
  readonly linkInvalid: boolean;
};

export function SignInForm({ returnPath, linkInvalid }: SignInFormProps) {
  const locale = useLocale();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    linkInvalid ? m["signIn.linkInvalid"]() : null
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError(m["signIn.invalidEmail"]());
      return;
    }

    setSending(true);
    setError(null);
    const result = await authClient.signIn
      .magicLink({
        email: address,
        callbackURL: getLocalizedHref(returnPath, locale),
        errorCallbackURL: getLocalizedHref("/sign-in", locale),
      })
      .catch(() => ({ error: { status: 0 } }));
    setSending(false);

    if (result.error) {
      setError(
        result.error.status === 429
          ? m["signIn.tooManyRequests"]()
          : m["signIn.sendFailed"]()
      );
      return;
    }
    setSentTo(address);
  }

  if (sentTo) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-800/60 p-6">
        <MailCheck className="mb-3 h-8 w-8 text-green-400" aria-hidden />
        <h2 className="mb-2 text-xl font-semibold text-white">
          {m["signIn.sentTitle"]()}
        </h2>
        <p className="text-gray-300" role="status">
          {m["signIn.sentBody"]({ email: sentTo })}
        </p>
        <p className="mt-3 text-sm text-gray-400">{m["signIn.sentHint"]()}</p>
        <Button
          type="button"
          variant="outline"
          className="mt-5 border-gray-600 bg-transparent text-white hover:bg-gray-700 hover:text-white"
          onClick={() => setSentTo(null)}
        >
          {m["signIn.sendAgain"]()}
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="rounded-lg border border-gray-700 bg-gray-800/60 p-6"
    >
      <Label htmlFor="sign-in-email" className="text-gray-200">
        {m["signIn.emailLabel"]()}
      </Label>
      <Input
        id="sign-in-email"
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder={m["signIn.emailPlaceholder"]()}
        variant={error ? "error" : "default"}
        aria-describedby={error ? "sign-in-error" : undefined}
        className="mt-2 border-gray-600 bg-gray-900 text-white placeholder-gray-500"
      />
      {error && (
        <p
          id="sign-in-error"
          role="alert"
          className="mt-2 text-sm text-red-400"
        >
          {error}
        </p>
      )}
      <Button
        type="submit"
        disabled={sending}
        className="mt-5 w-full bg-green-500 font-semibold text-gray-900 hover:bg-green-400"
      >
        {sending ? m["signIn.sending"]() : m["signIn.submit"]()}
      </Button>
      <p className="mt-4 text-xs text-gray-400">
        {m["signIn.privacyNote"]()}{" "}
        <LocalizedLink href="/gdpr" className="underline hover:text-white">
          {m["signIn.privacyLink"]()}
        </LocalizedLink>
      </p>
    </form>
  );
}
