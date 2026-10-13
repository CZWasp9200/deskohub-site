"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { getAccountSignInPath } from "@/features/account/routes";
import { type Locale, m } from "@/features/i18n";
import { SignInLoading } from "./sign-in-loading";

export function AccountSignInRedirect({ locale }: { readonly locale: Locale }) {
  const router = useRouter();
  const signInPath = getAccountSignInPath(locale);

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
