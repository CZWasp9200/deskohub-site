import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { listTrophies } from "@/features/account/backend/trophies.server";
import { AccountDataExport } from "@/features/account/components/account-data-export";
import { AccountsUnavailable } from "@/features/account/components/accounts-unavailable";
import { DeleteAccount } from "@/features/account/components/delete-account";
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
import { RegistrationControl } from "@/features/events/components/registration-control";
import { LocalizedLink, m, setLocale } from "@/features/i18n";
import { getLocalizedHref } from "@/features/i18n/utils/locale-url";
import {
  getMembershipState,
  listOfferedPlans,
} from "@/features/membership/backend/membership.server";
import { CancelMembershipRequestButton } from "@/features/membership/components/membership-actions";
import { PlanPicker } from "@/features/membership/components/plan-picker";
import {
  daysLeftForm,
  membershipDaysLeft,
  membershipLastMoment,
} from "@/features/membership/membership-period";
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

/**
 * The day and month for a date tile, taken from one formatted date so the
 * month keeps its grammatical form ("5. prosince", not "prosinec").
 */
function dateTile(date: Date, locale: string) {
  const parts = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    timeZone: siteConstants.workingHours.timezone,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const dayHasDot = parts.some(
    (p, index) =>
      p.type === "literal" &&
      p.value.startsWith(".") &&
      parts[index - 1]?.type === "day"
  );
  return { day: `${part("day")}${dayHasDot ? "." : ""}`, month: part("month") };
}

const daysLeftMessages = {
  one: (count: number) => m["account.membership.daysLeft.one"]({ count }),
  few: (count: number) => m["account.membership.daysLeft.few"]({ count }),
  other: (count: number) => m["account.membership.daysLeft.other"]({ count }),
};

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

  const daysLeft = membership.current
    ? membershipDaysLeft(membership.current.endsAt, new Date())
    : null;
  const priceFormat = new Intl.NumberFormat(locale);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <PageHeader
        title={m["account.title"]()}
        subtitle={m["account.greeting"]({ name: user.name })}
      >
        <div className="mt-6">
          <SignOutButton />
        </div>
      </PageHeader>

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-10 sm:px-6 lg:px-8">
        <AccountSection title={m["account.membership.title"]()}>
          <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div>
              {membership.current && daysLeft !== null ? (
                <>
                  <p className="text-2xl font-semibold text-green-400">
                    {membership.current.planName}
                  </p>
                  <p className="mt-2 text-lg text-white">
                    {daysLeftMessages[daysLeftForm(daysLeft, locale)](daysLeft)}
                  </p>
                  <p className="mt-1 text-sm text-gray-400">
                    {m["account.membership.activeUntil"]({
                      plan: membership.current.planName,
                      date: formatDate(
                        membershipLastMoment(membership.current.endsAt),
                        locale,
                        {
                          dateStyle: "long",
                        }
                      ),
                    })}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-2xl font-semibold text-white">
                    {m["account.membership.none"]()}
                  </p>
                  <p className="mt-2 text-gray-300">
                    {m["account.membership.noneHint"]()}
                  </p>
                </>
              )}
              <p className="mt-4">
                <LocalizedLink href="/membership" className={linkClass}>
                  {m["account.membership.view"]()}
                </LocalizedLink>
              </p>
            </div>

            <div>
              {membership.pendingRequest ? (
                <div className="rounded-md border border-amber-400/40 bg-amber-400/10 p-4">
                  <p className="text-amber-200">
                    {m["account.membership.pending"]({
                      plan: membership.pendingRequest.planName,
                      price: priceFormat.format(
                        membership.pendingRequest.priceCzk
                      ),
                    })}
                  </p>
                  <div className="mt-3">
                    <CancelMembershipRequestButton />
                  </div>
                </div>
              ) : (
                <>
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
                </>
              )}
              <p className="mt-4 text-sm text-gray-400">
                {m["account.membership.payAtBar"]()}
              </p>
            </div>
          </div>
        </AccountSection>

        <AccountSection title={m["account.registrations.title"]()}>
          {registrations.length > 0 ? (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {registrations.map((registration) => (
                <li
                  key={registration.eventId}
                  className="flex gap-4 rounded-lg border border-gray-700 bg-gray-900/60 p-4"
                >
                  <div className="flex w-16 shrink-0 flex-col items-center self-start rounded-md bg-gray-800 px-1 py-2 text-center">
                    <span className="text-2xl font-semibold leading-none text-white">
                      {dateTile(registration.startsAt, locale).day}
                    </span>
                    <span className="mt-1 text-xs font-medium text-green-400">
                      {dateTile(registration.startsAt, locale).month}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <LocalizedLink
                      href={`/events?month=${monthParam(registration.startsAt)}#event-${registration.eventId}`}
                      className="font-semibold text-white underline-offset-4 hover:underline"
                    >
                      {registration.title}
                    </LocalizedLink>
                    <p className="mt-0.5 text-sm text-gray-400">
                      {formatDate(registration.startsAt, locale, {
                        weekday: "long",
                      })}{" "}
                      {m["account.registrations.time"]({
                        time: formatDate(registration.startsAt, locale, {
                          timeStyle: "short",
                        }),
                      })}
                    </p>
                    <div className="mt-3">
                      <RegistrationControl
                        eventId={registration.eventId}
                        availability="registered"
                        signInHref={signInHref("/account")}
                      />
                    </div>
                  </div>
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

        <AccountSection title={m["account.profile.title"]()}>
          <div className="max-w-xl space-y-8">
            <ProfileForm name={user.name} email={user.email} />
            <AccountDataExport />
            <DeleteAccount hasMembership={membership.current !== null} />
          </div>
        </AccountSection>
      </div>
    </div>
  );
}
