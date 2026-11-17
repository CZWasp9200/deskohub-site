import { type Locale, m } from "@/features/i18n";
import { GuardedLink } from "@/shared/components/guarded-link";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils";
import { formatInstantDate } from "@/shared/utils/date-time-format";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

/**
 * A reservation the customer may still withdraw from (§1830a): the last
 * moment of its withdrawal period. Stub read model until the withdrawal
 * quote lands.
 */
export type ReservationWithdrawalOffer = {
  readonly periodEndsAt: string;
};

const formatWithdrawalPeriodEnd = (periodEndsAt: string, locale: Locale) =>
  formatInstantDate({
    instant: Temporal.Instant.from(periodEndsAt),
    locale,
    dateStyle: "long",
    timeZone: workspaceSiteConstants.location.timeZone,
  });

/**
 * The "Withdraw from contract" entry for an eligible reservation, with the
 * date until which withdrawal is possible. `panel` sits in the reservation
 * view; `row` closes an account reservation card.
 */
export function ReservationWithdrawalEntry({
  className,
  href,
  locale,
  offer,
  presentation,
}: {
  readonly className?: string;
  readonly href: string;
  readonly locale: Locale;
  readonly offer: ReservationWithdrawalOffer;
  readonly presentation: "panel" | "row";
}) {
  const availableUntil = m.reservationWithdrawalAvailableUntil(
    { date: formatWithdrawalPeriodEnd(offer.periodEndsAt, locale) },
    { locale }
  );

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-3",
        presentation === "panel"
          ? "rounded-2xl border border-[#dfe4ec] bg-[#f6f8fa] p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
          : "@3xl:flex-row @3xl:items-center @3xl:justify-between @3xl:gap-6",
        className
      )}
      data-reservation-withdrawal-entry={presentation}
    >
      <p className="min-w-0 break-words text-sm leading-5 text-[#475569]">
        {availableUntil}
      </p>
      <Button
        asChild
        className={cn(
          "shrink-0",
          presentation === "panel" ? "sm:w-auto" : "@3xl:w-auto"
        )}
        fullWidth
        size={presentation === "panel" ? "lg" : "sm"}
        variant="secondary"
        wrap
      >
        <GuardedLink href={href}>
          {m.reservationWithdrawalAction({}, { locale })}
        </GuardedLink>
      </Button>
    </div>
  );
}
