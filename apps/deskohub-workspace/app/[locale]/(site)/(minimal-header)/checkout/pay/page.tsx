import { Effect, Layer, Option } from "effect";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  CheckoutUnavailableError,
  discountCodeErrorIdQueryParam,
  discountCodeErrorQueryParam,
  PayableCheckout,
  PayState,
  payStateTokenQueryParam,
} from "@/features/checkout/backend/checkout";
import {
  checkoutOfficePeopleForVisitorServices,
  findCheckoutOfficePeopleForVisitor,
} from "@/features/checkout/backend/checkout/pay-state-checkout-view";
import { isOrderBoundPayState } from "@/features/checkout/backend/checkout/pay-state-contract";
import {
  checkoutReferralAppliedQueryParam,
  hasCheckoutReferralAppliedNotice,
} from "@/features/checkout/checkout-referral-notice";
import { CheckoutDiscountCodeForm } from "@/features/checkout/components/checkout-discount-code-form";
import { CheckoutFlowLayout } from "@/features/checkout/components/checkout-flow-layout";
import { CheckoutPayPage } from "@/features/checkout/components/checkout-pay-page";
import { CheckoutPayPageSkeleton } from "@/features/checkout/components/checkout-pay-page-skeleton";
import { parseDiscountCodeRejection } from "@/features/checkout/discount-code-rejection";
import { getDiscountCodeEntryEnabled } from "@/features/discounts/discount-code-entry.server";
import { type Locale, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import {
  getEarlyPerformanceRequestRequiredAt,
  isEarlyPerformanceRequestRequired,
} from "@/features/legal/early-performance";
import { createNoindexedPageMetadata } from "@/features/public-pages/page-metadata";
import { reservationCheckoutStepQueryParam } from "@/features/reservation/reservation-checkout-step";
import {
  getCoworkReservationPath,
  getReservationStartPath,
} from "@/features/reservation/routes";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { RouteAutoRefresh } from "@/shared/components/route-auto-refresh";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { getSearchParam, type SearchParamsRecord } from "@/shared/utils";

type SignedPayState = Effect.Success<ReturnType<typeof PayState.open>>;

type LocalizedCheckoutPayPageProps = {
  searchParams: Promise<SearchParamsRecord>;
};

// Keep the pay route non-instant: it is reached from a Server Action redirect,
// and making its intermediate shell interactive can let a follow-up navigation
// race the still-settling checkout transition.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) =>
    createNoindexedPageMetadata({
      locale,
      title: { absolute: m.checkoutPayMetadataTitle({}, { locale }) },
      description: m.checkoutPayMetadataDescription({}, { locale }),
    })
  );
}

export default async function LocalizedCheckoutPayPage({
  searchParams,
}: LocalizedCheckoutPayPageProps) {
  return runWithRequestLocale((locale) => (
    <Suspense
      fallback={
        <CheckoutFlowLayout activeStepKey="pay" locale={locale}>
          <CheckoutPayPageSkeleton locale={locale} />
        </CheckoutFlowLayout>
      }
    >
      <CheckoutPayContent locale={locale} searchParams={searchParams} />
    </Suspense>
  ));
}

/**
 * The reservation kind an unusable Pay state restarts with: the kind of an
 * order that can't be paid, else whatever kind the token can still name.
 */
const getRestartKind = (cause: unknown, payStateToken: string) =>
  cause instanceof CheckoutUnavailableError
    ? Effect.succeed(cause.restartKind)
    : PayState.restartKind(payStateToken).pipe(
        Effect.provide(SealedStateKeys.Default),
        Effect.orElseSucceed(() => undefined)
      );

type PayableCheckoutPage = Extract<
  Awaited<ReturnType<typeof loadPayableCheckout>>,
  { readonly status: "payable" }
>;

/**
 * The opened checkout whose held reservation the Pay state still pays for,
 * with what the page needs alongside it, or the reservation kind to restart
 * with once the state can't be paid on this page.
 */
const loadPayableCheckout = (payStateToken: string, locale: Locale) =>
  Effect.Do.pipe(
    Effect.bind("payableCheckout", () => PayableCheckout),
    Effect.bind("checkout", ({ payableCheckout }) =>
      payableCheckout.open({ payStateToken, page: { locale } })
    ),
    Effect.bind("officePeople", ({ checkout }) =>
      checkout.state.reservation.kind === "office"
        ? findCheckoutOfficePeopleForVisitor({ payStateToken, locale }).pipe(
            Effect.provide(checkoutOfficePeopleForVisitorServices),
            Effect.orElseSucceed(() => Option.none())
          )
        : Effect.succeed(Option.none())
    ),
    Effect.bind("discountCodeEntryEnabled", () => getDiscountCodeEntryEnabled),
    Effect.bind("freshPayUrl", ({ checkout }) =>
      PayState.reissue(checkout.state, { kind: "reviewed" }).pipe(
        Effect.map(({ payUrl }) => payUrl),
        Effect.when(Effect.succeed(checkout.state.changedKeys !== undefined)),
        Effect.map(Option.getOrUndefined)
      )
    ),
    Effect.map(
      ({ checkout, discountCodeEntryEnabled, freshPayUrl, officePeople }) => ({
        status: "payable" as const,
        checkout,
        discountCodeEntryEnabled,
        freshPayUrl,
        officePeople: Option.getOrUndefined(officePeople),
      })
    ),
    // A key ring or provider configuration that can't be read leaves the
    // checkout unpayable, like any other failure to open it.
    Effect.provide(Layer.merge(PayableCheckout.Live, SealedStateKeys.Default)),
    Effect.catch((cause) =>
      Effect.logWarning("Checkout pay state could not be loaded", {
        cause,
        reason: "payStateUnavailable",
      }).pipe(
        Effect.andThen(getRestartKind(cause, payStateToken)),
        Effect.map((restartKind) => ({
          status: "unavailable" as const,
          restartKind,
        }))
      )
    ),
    runWorkspaceEffect("checkout.pay.load")
  );

/** Where a customer with an unusable Pay state starts their order again. */
const getPayRestartPath = (
  locale: Locale,
  restartKind: SignedPayState["reservation"]["kind"] | undefined
) =>
  Option.fromNullishOr(restartKind).pipe(
    Option.map((reservationKind) =>
      getReservationStartPath(locale, reservationKind)
    ),
    Option.getOrElse(() => getCoworkReservationPath(locale))
  );

async function CheckoutPayContent({
  locale,
  searchParams,
}: {
  readonly locale: Locale;
  readonly searchParams: Promise<SearchParamsRecord>;
}) {
  await connection();
  const resolvedSearchParams = await searchParams;
  const payStateToken = getSearchParam(
    resolvedSearchParams,
    payStateTokenQueryParam
  );

  if (!payStateToken) {
    return runWithRequestLocale(() => (
      <InvalidPayState
        locale={locale}
        restartPath={getCoworkReservationPath(locale)}
      />
    ));
  }

  const payableCheckout = await loadPayableCheckout(payStateToken, locale);
  if (payableCheckout.status === "unavailable") {
    const restartPath = getPayRestartPath(locale, payableCheckout.restartKind);
    return runWithRequestLocale(() => (
      <InvalidPayState locale={locale} restartPath={restartPath} />
    ));
  }

  return runWithRequestLocale(() =>
    renderCheckoutPay({
      locale,
      payableCheckout,
      payStateToken,
      searchParams: resolvedSearchParams,
      state: payableCheckout.checkout.state,
    })
  );
}

type CheckoutPayRenderInput = {
  readonly locale: Locale;
  readonly payableCheckout: PayableCheckoutPage;
  readonly payStateToken: string;
  readonly searchParams: SearchParamsRecord;
  readonly state: SignedPayState;
};

/** The Pay step for a Pay state whose reservation is still held. */
function renderCheckoutPay(input: CheckoutPayRenderInput) {
  const { locale, payableCheckout, payStateToken, state } = input;
  const { officePeople } = payableCheckout;
  const orderPath = getReservationStartPath(
    locale,
    state.reservation.kind,
    new URLSearchParams({ [payStateTokenQueryParam]: payStateToken })
  );
  const contactPath = getReservationStartPath(
    locale,
    state.reservation.kind,
    new URLSearchParams({
      [payStateTokenQueryParam]: payStateToken,
      [reservationCheckoutStepQueryParam]: "contact",
    })
  );
  const earlyPerformanceRequestRequired = isEarlyPerformanceRequestRequired({
    reservation: state.reservation,
    contractAt: Temporal.Now.instant(),
  });

  return (
    <CheckoutFlowLayout
      activeStepKey="pay"
      locale={locale}
      stepLinks={{
        chooseSpace: { href: orderPath, navigation: "document" },
        contact: { href: contactPath, navigation: "document" },
      }}
    >
      {!earlyPerformanceRequestRequired && (
        <RouteAutoRefresh
          enabled={false}
          intervalMs={60_000}
          refreshAt={getEarlyPerformanceRequestRequiredAt(
            state.reservation
          ).toString()}
          refreshOnFocus
        />
      )}
      <CheckoutPayPage
        changedKeys={state.changedKeys}
        discountCodeForm={renderDiscountCodeForm(input)}
        freshPayUrl={payableCheckout.freshPayUrl}
        earlyPerformanceRequestRequired={earlyPerformanceRequestRequired}
        locale={locale}
        officeStartDateLabel={
          state.reservation.kind === "office"
            ? Temporal.PlainDate.from(
                state.reservation.startsOn
              ).toLocaleString(locale, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })
            : undefined
        }
        key={earlyPerformanceRequestRequired ? "early-performance" : "standard"}
        payStateToken={state.changedKeys ? undefined : payStateToken}
        people={
          officePeople && {
            ...officePeople,
            contact: {
              name: state.reservation.name,
              email: state.reservation.email,
            },
          }
        }
        summary={PayState.summary(state)}
        variant={getPayPageVariant(state)}
      />
    </CheckoutFlowLayout>
  );
}

/**
 * The Pay page a signed state opens: a changed price to accept first, the
 * same order's payment tried again, or its first payment.
 */
const getPayPageVariant = (state: SignedPayState) => {
  if (state.changedKeys) return "pricingChanged";
  return isOrderBoundPayState(state) ? "retry" : "pay";
};

/**
 * The discount code form, showing the code the Pay state carries and the
 * rejection the last submission redirected back with.
 */
function renderDiscountCodeForm({
  locale,
  payableCheckout,
  payStateToken,
  searchParams,
  state,
}: CheckoutPayRenderInput) {
  const submittedCodeApplication = PayState.submittedCodeApplication(state);
  return (
    <CheckoutDiscountCodeForm
      appliedAdjustment={submittedCodeApplication?.discount.adjustment}
      defaultCode={state.requestedDiscountCode ?? state.submittedCode}
      enabled={
        payableCheckout.discountCodeEntryEnabled &&
        state.submittedCode === undefined
      }
      locale={locale}
      payStateToken={payStateToken}
      referralApplied={hasCheckoutReferralAppliedNotice({
        discounts: state.quote.payment.discounts,
        dotyposCustomerId:
          payableCheckout.checkout.reservation.dotyposCustomerId,
        marker: searchParams[checkoutReferralAppliedQueryParam],
      })}
      rejection={parseDiscountCodeRejection(
        getSearchParam(searchParams, discountCodeErrorQueryParam)
      )}
      rejectionId={getSearchParam(searchParams, discountCodeErrorIdQueryParam)}
    />
  );
}

function InvalidPayState({
  locale,
  restartPath,
}: {
  readonly locale: Locale;
  readonly restartPath: string;
}) {
  return (
    <CheckoutFlowLayout activeStepKey="pay" locale={locale}>
      <Card className="relative overflow-hidden rounded-4xl border-white/55 bg-white/94 text-navy-blue shadow-[0_44px_140px_-54px_rgba(0,2,79,0.62)] backdrop-blur-sm">
        <CardHeader className="space-y-3 pb-6">
          <CardTitle as="h1" className="text-3xl sm:text-[2.35rem]">
            {m.checkoutPayInvalidStateTitle({}, { locale })}
          </CardTitle>
          <CardDescription className="max-w-2xl font-mono text-9xl text-center leading-96 text-navy-blue/50 sm:text-8xl">
            {m.checkoutPayInvalidStateLead({}, { locale })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild size="xl" caps fullWidth>
            <a href={restartPath}>
              {m.checkoutPayRestartButton({}, { locale })}
            </a>
          </Button>
        </CardContent>
      </Card>
    </CheckoutFlowLayout>
  );
}
