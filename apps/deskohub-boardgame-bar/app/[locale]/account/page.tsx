import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { listTrophies } from "@/features/account/backend/trophies.server";
import { AccountsUnavailable } from "@/features/account/components/accounts-unavailable";
import { ProfileForm } from "@/features/account/components/profile-form";
import { SignOutButton } from "@/features/account/components/sign-out-button";
import { TrophyList } from "@/features/account/components/trophy-list";
import {
  areAccountsAvailable,
  getSessionUser,
} from "@/features/account/server/session.server";
import { signInHref } from "@/features/account/sign-in-path";
import { listUpcomingRegistrations } from "@/features/events/backend/events.server";
import { monthParam } from "@/features/events/calendar-month";
import { LocalizedLink, m, setLocale } from "@/features/i18n";
import { getLocalizedHref } from "@/features/i18n/utils/locale-url";
import {
  getMembershipState,
  listOfferedPlans,
} from "@/features/membership/backend/membership.server";
import { CancelMembershipRequestButton } from "@/features/membership/components/membership-actions";
import { PlanPicker } from "@/features/membership/components/plan-picker";
import { PageHeader } from "@/shared/components/page-header";
import { siteConstants } from "@/shared/utils/constants";
import { formatDate } from "@/shared/utils/date-formatting";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "../route";

export const generateMetadata = metadata({
  title: () => m["account.pageTitle"](),
  description: () => m["account.pageDescription"](),
});

const linkClass =
  "font-medium text-green-400 underline-offset-4 hover:underline";

function AccountSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-700 bg-gray-800/60 p-6">
      <h2 className="mb-4 text-xl font-semibold text-white">{title}</h2>
      {children}
    </section>
  );
}

export default async function AccountPage({ params }: RouteProps_locale) {
  if (!siteConstants.featureFlags.accounts) notFound();

  const { locale } = await params;
  setLocale(locale);

  if (!areAccountsAvailable()) {
    return (
      <div className="min-h-screen bg-gray-900 text-white">
        <PageHeader title={m["account.title"]()} />
        <AccountsUnavailable />
      </div>
    );
  }

  const user = await getSessionUser();
  if (!user) redirect(getLocalizedHref(signInHref("/account"), locale));

  const [membership, plans, trophies, registrations] = await Promise.all([
    getMembershipState(user.id),
    listOfferedPlans(),
    listTrophies(user.id),
    listUpcomingRegistrations(user.id),
  ]);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <PageHeader
        title={m["account.title"]()}
        subtitle={m["account.signedInAs"]({ email: user.email })}
      >
        <div className="mt-6">
          <SignOutButton />
        </div>
      </PageHeader>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-2 lg:px-8">
        <AccountSection title={m["account.profile.title"]()}>
          <ProfileForm name={user.name} email={user.email} />
        </AccountSection>

        <AccountSection title={m["account.membership.title"]()}>
          <p className="text-gray-300">
            {membership.current
              ? m["account.membership.activeUntil"]({
                  plan: membership.current.planName,
                  date: formatDate(membership.current.endsAt, locale, {
                    dateStyle: "long",
                  }),
                })
              : m["account.membership.none"]()}
          </p>
          {membership.pendingRequest ? (
            <div className="mt-4 rounded-md border border-amber-400/40 bg-amber-400/10 p-4">
              <p className="text-amber-200">
                {m["account.membership.pending"]({
                  plan: membership.pendingRequest.planName,
                  price: new Intl.NumberFormat(locale).format(
                    membership.pendingRequest.priceCzk
                  ),
                })}
              </p>
              <div className="mt-3">
                <CancelMembershipRequestButton />
              </div>
            </div>
          ) : (
            <div className="mt-5">
              <h3 className="mb-3 font-medium text-white">
                {membership.current
                  ? m["account.membership.extend"]()
                  : m["account.membership.choose"]()}
              </h3>
              {plans && plans.length > 0 ? (
                <PlanPicker plans={plans} locale={locale} />
              ) : (
                <p className="text-gray-400">
                  {m["account.membership.noPlans"]()}
                </p>
              )}
            </div>
          )}
          <p className="mt-4 text-sm text-gray-400">
            {m["account.membership.payAtBar"]()}
          </p>
          <p className="mt-3">
            <LocalizedLink href="/membership" className={linkClass}>
              {m["account.membership.view"]()}
            </LocalizedLink>
          </p>
        </AccountSection>

        <div className="lg:col-span-2">
          <AccountSection title={m["account.trophies.title"]()}>
            {trophies.length > 0 ? (
              <TrophyList trophies={trophies} locale={locale} />
            ) : (
              <>
                <p className="text-gray-300">{m["account.trophies.empty"]()}</p>
                <p className="mt-4">
                  <LocalizedLink href="/events" className={linkClass}>
                    {m["account.trophies.browseEvents"]()}
                  </LocalizedLink>
                </p>
              </>
            )}
          </AccountSection>
        </div>

        <div className="lg:col-span-2">
          <AccountSection title={m["account.registrations.title"]()}>
            {registrations.length > 0 ? (
              <ul className="divide-y divide-gray-700">
                {registrations.map((registration) => (
                  <li
                    key={registration.eventId}
                    className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3 first:pt-0 last:pb-0"
                  >
                    <LocalizedLink
                      href={`/events?month=${monthParam(registration.startsAt)}#event-${registration.eventId}`}
                      className={linkClass}
                    >
                      {registration.title}
                    </LocalizedLink>
                    <span className="text-sm text-gray-300">
                      {formatDate(registration.startsAt, locale, {
                        dateStyle: "full",
                        timeStyle: "short",
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <>
                <p className="text-gray-300">
                  {m["account.registrations.empty"]()}
                </p>
                <p className="mt-4">
                  <LocalizedLink href="/events" className={linkClass}>
                    {m["account.trophies.browseEvents"]()}
                  </LocalizedLink>
                </p>
              </>
            )}
          </AccountSection>
        </div>
      </div>
    </div>
  );
}
