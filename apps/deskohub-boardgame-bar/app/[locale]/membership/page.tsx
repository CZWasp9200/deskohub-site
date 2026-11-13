import { Check } from "lucide-react";
import { notFound } from "next/navigation";
import { AccountsUnavailable } from "@/features/account/components/accounts-unavailable";
import { getSessionUser } from "@/features/account/server/session.server";
import { signInHref } from "@/features/account/sign-in-path";
import { m, setLocale } from "@/features/i18n";
import {
  getMembershipState,
  listOfferedPlans,
  type MembershipPlan,
} from "@/features/membership/backend/membership.server";
import {
  CancelMembershipRequestButton,
  RequestMembershipButton,
} from "@/features/membership/components/membership-actions";
import { PageHeader } from "@/shared/components/page-header";
import { siteConstants } from "@/shared/utils/constants";
import { formatDate } from "@/shared/utils/date-formatting";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "../route";

export const generateMetadata = metadata({
  title: () => m["membership.pageTitle"](),
  description: () => m["membership.pageDescription"](),
});

function planDuration(plan: MembershipPlan): string {
  if (plan.durationDays === 365) return m["membership.durationYear"]();
  if (plan.durationDays === 30) return m["membership.durationMonth"]();
  return m["membership.durationDays"]({ days: plan.durationDays });
}

export default async function MembershipPage({ params }: RouteProps_locale) {
  if (!siteConstants.featureFlags.accounts) notFound();

  const { locale } = await params;
  setLocale(locale);

  const [plans, user] = await Promise.all([
    listOfferedPlans(),
    getSessionUser(),
  ]);
  const membership = user ? await getMembershipState(user.id) : null;
  const priceFormat = new Intl.NumberFormat(locale);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <PageHeader
        title={m["membership.title"]()}
        subtitle={m["membership.subtitle"]()}
      />

      {plans === undefined ? (
        <AccountsUnavailable />
      ) : (
        <div className="mx-auto max-w-7xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
          {membership?.current && (
            <section className="rounded-lg border border-green-500/40 bg-green-500/10 p-5">
              <h2 className="text-lg font-semibold text-green-300">
                {m["membership.current.title"]()}
              </h2>
              <p className="mt-1 text-gray-200">
                {m["membership.current.body"]({
                  plan: membership.current.planName,
                  date: formatDate(membership.current.endsAt, locale, {
                    dateStyle: "long",
                  }),
                })}
              </p>
              <p className="mt-1 text-sm text-gray-400">
                {m["membership.current.extendHint"]()}
              </p>
            </section>
          )}

          {membership?.pendingRequest && (
            <section className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-5">
              <h2 className="text-lg font-semibold text-amber-200">
                {m["membership.pending.title"]()}
              </h2>
              <p className="mt-1 text-gray-200">
                {m["membership.pending.body"]({
                  plan: membership.pendingRequest.planName,
                  price: priceFormat.format(membership.pendingRequest.priceCzk),
                })}
              </p>
              <div className="mt-4">
                <CancelMembershipRequestButton />
              </div>
            </section>
          )}

          {plans.length === 0 ? (
            <section className="py-12 text-center">
              <h2 className="text-xl font-semibold">
                {m["membership.empty.title"]()}
              </h2>
              <p className="mt-2 text-gray-400">
                {m["membership.empty.hint"]()}
              </p>
            </section>
          ) : (
            <>
              <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {plans.map((plan) => (
                  <li
                    key={plan.id}
                    className="flex flex-col rounded-lg border border-gray-700 bg-gray-800/60 p-6"
                  >
                    <h2 className="text-xl font-semibold text-white">
                      {plan.name}
                    </h2>
                    {plan.description && (
                      <p className="mt-1 text-gray-300">{plan.description}</p>
                    )}
                    <p className="mt-4">
                      <span className="text-3xl font-bold text-green-400">
                        {m["membership.price"]({
                          price: priceFormat.format(plan.priceCzk),
                        })}
                      </span>{" "}
                      <span className="text-gray-400">
                        {planDuration(plan)}
                      </span>
                    </p>
                    {plan.benefits.length > 0 && (
                      <ul className="mt-5 space-y-2">
                        {plan.benefits.map((benefit) => (
                          <li
                            key={benefit}
                            className="flex gap-2 text-gray-200"
                          >
                            <Check
                              className="mt-0.5 h-5 w-5 shrink-0 text-green-400"
                              aria-hidden
                            />
                            {benefit}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-auto pt-6">
                      <RequestMembershipButton
                        planId={plan.id}
                        signedIn={user !== null}
                        signInHref={signInHref("/membership")}
                        disabled={Boolean(membership?.pendingRequest)}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              <p className="max-w-3xl text-sm text-gray-400">
                {m["membership.paymentNote"]()}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
