"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { getAccountSignInPath } from "@/features/account/routes";
import { type Locale, m } from "@/features/i18n";
import type { ReferralCode } from "@/features/referrals/client";
import { SignInLoading } from "./sign-in-loading";

export function AccountSignInRedirect({
  locale,
  referralCode,
}: {
  readonly locale: Locale;
  readonly referralCode?: ReferralCode;
}) {
  const router = useRouter();
  const signInBasePath = getAccountSignInPath(locale);
  const searchParams = new URLSearchParams();
  if (referralCode !== undefined) searchParams.set("ref", referralCode);
  const search = searchParams.toString();
  const signInPath =
    search.length === 0 ? signInBasePath : `${signInBasePath}?${search}`;

  useEffect(() => {
    router.replace(signInPath);
  }, [router, signInPath]);

  return (
    <>
      <SignInLoading locale={locale} />
      <noscript>
        <a href={signInPath}>{m.accountSignInTitle({}, { locale })}</a>
      </noscript>
    </>
  );
}
