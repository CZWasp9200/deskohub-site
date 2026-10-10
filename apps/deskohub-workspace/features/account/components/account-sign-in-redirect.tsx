"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { getAccountSignInPath } from "@/features/account/routes";
import { type Locale, m } from "@/features/i18n";
import { SignInLoading } from "./sign-in-loading";

export function AccountSignInRedirect({ locale }: { readonly locale: Locale }) {
  const router = useRouter();

  useEffect(() => {
    router.replace(getAccountSignInPath(locale));
  }, [locale, router]);

  return (
    <>
      <SignInLoading locale={locale} />
      <noscript>
        <a href={getAccountSignInPath(locale)}>
          {m.accountSignInTitle({}, { locale })}
        </a>
      </noscript>
    </>
  );
}
