import { notFound, redirect } from "next/navigation";
import { AccountsUnavailable } from "@/features/account/components/accounts-unavailable";
import { SignInForm } from "@/features/account/components/sign-in-form";
import {
  areAccountsAvailable,
  getSessionUser,
} from "@/features/account/server/session.server";
import { safeReturnPath } from "@/features/account/sign-in-path";
import { m, setLocale } from "@/features/i18n";
import { getLocalizedHref } from "@/features/i18n/utils/locale-url";
import { PageHeader } from "@/shared/components/page-header";
import { siteConstants } from "@/shared/utils/constants";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "../route";

export const generateMetadata = metadata({
  title: () => m["signIn.pageTitle"](),
  description: () => m["signIn.pageDescription"](),
});

type SignInPageProps = RouteProps_locale & {
  searchParams: Promise<{ next?: string; error?: string }>;
};

export default async function SignInPage({
  params,
  searchParams,
}: SignInPageProps) {
  if (!siteConstants.featureFlags.accounts) notFound();

  const { locale } = await params;
  setLocale(locale);
  const { next, error } = await searchParams;
  const returnPath = safeReturnPath(next);

  if (await getSessionUser()) {
    redirect(getLocalizedHref(returnPath, locale));
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <PageHeader
        title={m["signIn.title"]()}
        subtitle={m["signIn.subtitle"]()}
      />
      {areAccountsAvailable() ? (
        <section className="mx-auto max-w-md px-4 py-12">
          <SignInForm returnPath={returnPath} linkInvalid={Boolean(error)} />
        </section>
      ) : (
        <AccountsUnavailable />
      )}
    </div>
  );
}
