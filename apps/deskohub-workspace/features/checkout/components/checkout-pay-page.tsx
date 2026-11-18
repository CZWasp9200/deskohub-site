"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type {
  CheckoutSummaryChangedKeys,
  CheckoutSummary as CheckoutSummaryData,
} from "@/features/checkout/checkout-summary";
import { CheckoutBanner } from "@/features/checkout/components/checkout-banner";
import { CheckoutDiscountCountdownBanner } from "@/features/checkout/components/checkout-discount-countdown-banner";
import { CheckoutSummary } from "@/features/checkout/components/checkout-summary";
import { type Locale, m } from "@/features/i18n";
import {
  type OfficeCheckoutPeople,
  OfficeCheckoutPeopleReview,
} from "@/features/office/components/office-checkout-people";
import { getCoworkReservationPath } from "@/features/reservation/routes";
import { Button } from "@/shared/components/ui/button";
import {
  CheckoutPayCard,
  CheckoutPayConsent,
  CheckoutPayProviderHandoff,
  CheckoutPaySubmitButton,
} from "./checkout-pay-page-card";
import { useCheckoutPaySubmission } from "./use-checkout-pay-submission";

type CheckoutPayPageProps = {
  readonly changedKeys?: CheckoutSummaryChangedKeys;
  readonly discountCodeForm?: ReactNode;
  readonly earlyPerformanceRequestRequired?: boolean;
  readonly freshPayUrl?: string;
  readonly locale: Locale;
  /** An office order's first day, which its order line names. */
  readonly officeStartDateLabel?: string;
  readonly payStateToken?: string;
  /** Who is coming to an office order with a people list. */
  readonly people?: OfficeCheckoutPeople;
  readonly summary: CheckoutSummaryData;
  readonly variant: "pay" | "retry" | "pricingChanged";
  readonly retryOutcome?: "cancelled" | "failed";
};

export function CheckoutPayPage({
  changedKeys,
  discountCodeForm,
  earlyPerformanceRequestRequired = true,
  freshPayUrl,
  locale,
  officeStartDateLabel,
  payStateToken,
  people,
  retryOutcome,
  summary,
  variant,
}: CheckoutPayPageProps) {
  const {
    errorMessage,
    isSubmitPending,
    legalConsent,
    setLegalConsent,
    submit,
  } = useCheckoutPaySubmission({
    earlyPerformanceRequestRequired,
    locale,
    payStateToken,
  });
  const isPricingChanged = variant === "pricingChanged";
  const title = {
    pay: m.checkoutPayTitle({}, { locale }),
    retry: m.checkoutPaymentRetryTitle({}, { locale }),
    pricingChanged: m.checkoutPayPricingChangedTitle({}, { locale }),
  }[variant];
  const lead = {
    pay: null,
    retry: m.checkoutPaymentRetryLead({}, { locale }),
    pricingChanged: m.checkoutPayPricingChangedLead({}, { locale }),
  }[variant];
  const actionVariant = (
    {
      pay: "pay",
      retry: "retry",
      pricingChanged: "pay",
    } as const
  )[variant];
  // A free order completes without the payment provider.
  const providerTotal = summary.total.value > 0 ? summary.total : undefined;

  return (
    <CheckoutPayCard lead={lead} title={title}>
      <CheckoutPayNotices
        isPricingChanged={isPricingChanged}
        locale={locale}
        retryOutcome={retryOutcome}
      />

      <CheckoutDiscountCountdownBanner locale={locale} summary={summary} />

      {people ? (
        <div className="@container">
          <div className="grid items-start gap-3 @3xl:grid-cols-2">
            <CheckoutSummary
              changedKeys={changedKeys}
              locale={locale}
              officeStartDateLabel={officeStartDateLabel}
              summary={summary}
            />
            <OfficeCheckoutPeopleReview locale={locale} people={people} />
          </div>
        </div>
      ) : (
        <CheckoutSummary
          changedKeys={changedKeys}
          locale={locale}
          officeStartDateLabel={officeStartDateLabel}
          summary={summary}
        />
      )}

      {variant === "pay" && discountCodeForm}

      {isPricingChanged ? (
        <CheckoutPayUpdatedPriceLink
          freshPayUrl={freshPayUrl}
          locale={locale}
        />
      ) : (
        <>
          <CheckoutPayConsent
            checked={legalConsent}
            id="checkout-pay-legal-consent"
            locale={locale}
            onCheckedChange={setLegalConsent}
            showEarlyPerformanceRequest={earlyPerformanceRequestRequired}
            variant={actionVariant}
          />

          <CheckoutPaySubmitButton
            disabled={!legalConsent || isSubmitPending}
            locale={locale}
            onClick={submit}
            pending={isSubmitPending}
            total={providerTotal}
            variant={actionVariant}
          />

          {!!providerTotal && <CheckoutPayProviderHandoff locale={locale} />}
        </>
      )}

      {!!errorMessage && (
        <CheckoutBanner role="alert">{errorMessage}</CheckoutBanner>
      )}
    </CheckoutPayCard>
  );
}

/** Why the customer is back on the Pay page, when they are. */
function CheckoutPayNotices({
  isPricingChanged,
  locale,
  retryOutcome,
}: {
  readonly isPricingChanged: boolean;
  readonly locale: Locale;
  readonly retryOutcome: CheckoutPayPageProps["retryOutcome"];
}) {
  return (
    <>
      {!!retryOutcome && (
        <CheckoutBanner>
          {
            {
              cancelled: m.checkoutPaymentRetryCancelledBanner({}, { locale }),
              failed: m.checkoutPaymentRetryFailedBanner({}, { locale }),
            }[retryOutcome]
          }
        </CheckoutBanner>
      )}

      {isPricingChanged && (
        <CheckoutBanner>
          {m.checkoutPayPricingChangedBanner({}, { locale })}
        </CheckoutBanner>
      )}
    </>
  );
}

function CheckoutPayUpdatedPriceLink({
  freshPayUrl,
  locale,
}: {
  readonly freshPayUrl: string | undefined;
  readonly locale: Locale;
}) {
  return (
    <Button asChild size="xl" caps fullWidth>
      <Link
        href={freshPayUrl ?? getCoworkReservationPath(locale)}
        prefetch={false}
      >
        {m.checkoutPayReviewUpdatedPriceButton({}, { locale })}
      </Link>
    </Button>
  );
}
