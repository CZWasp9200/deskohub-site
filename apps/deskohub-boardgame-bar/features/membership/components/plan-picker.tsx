import { m } from "@/features/i18n";
import type { MembershipPlan } from "@/features/membership/backend/membership.server";
import { RequestMembershipButton } from "@/features/membership/components/membership-actions";
import { planDuration } from "@/features/membership/plan-duration";

/**
 * The offered plans as compact rows the signed-in customer picks from in
 * their account. Picking one sends a request that is paid at the bar.
 */
export function PlanPicker({
  plans,
  locale,
}: {
  readonly plans: readonly MembershipPlan[];
  readonly locale: string;
}) {
  const priceFormat = new Intl.NumberFormat(locale);

  return (
    <ul className="divide-y divide-gray-700 rounded-md border border-gray-700">
      {plans.map((plan) => (
        <li
          key={plan.id}
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
        >
          <div>
            <p className="font-medium text-white">{plan.name}</p>
            <p className="text-sm text-gray-400">
              <span className="font-semibold text-green-400">
                {m["membership.price"]({
                  price: priceFormat.format(plan.priceCzk),
                })}
              </span>{" "}
              {planDuration(plan.durationDays)}
            </p>
          </div>
          <RequestMembershipButton
            planId={plan.id}
            signedIn
            signInHref="/sign-in"
            disabled={false}
            compact
          />
        </li>
      ))}
    </ul>
  );
}
