import { Effect, Layer, Option, Schema } from "effect";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
import {
  CheckoutStatusService,
  loadCheckoutStatusPage,
} from "@/features/checkout/backend/checkout";
import {
  getReservationStatusSignInPath,
  isStatusViewerSignedOut,
} from "@/features/checkout/backend/checkout/checkout-status-sign-in";
import { checkoutStatusTraits } from "@/features/checkout/checkout-status-kind";
import { CheckoutFlowLayout } from "@/features/checkout/components/checkout-flow-layout";
import { CheckoutPaymentWindowCoordinator } from "@/features/checkout/components/checkout-payment-window";
import { CheckoutStatusPage } from "@/features/checkout/components/checkout-status-page";
import { CheckoutStatusPageSkeleton } from "@/features/checkout/components/checkout-status-page-skeleton";
import { CheckoutStatusReferralCodeSettlement } from "@/features/checkout/components/checkout-status-referral-code-settlement";
import type { Locale } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { loadOrderKind } from "@/features/order/backend/order-kind";
import { readReservationAccessCookie } from "@/features/reservation/backend/reservation-access-cookie";
import { ReservationAuthorizationService } from "@/features/reservation/backend/reservation-authorization.service";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { readReservationWithdrawalEntry } from "@/features/withdrawal/backend/withdrawal-entry.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { RouteAutoRefresh } from "@/shared/components/route-auto-refresh";
import {
  getSearchParamsDecoder,
  type SearchParamsRecord,
} from "@/shared/utils";

type CheckoutStatusPresentation = "page" | "modal";

type CheckoutStatusRouteProps = {
  readonly params: Promise<{ orderId: string }>;
  readonly searchParams: Promise<SearchParamsRecord>;
  readonly presentation?: CheckoutStatusPresentation;
};

const decodeCheckoutStatusParams = Schema.decodeUnknownOption(
  Schema.Struct({ orderId: workspaceReservationIdSchema })
);

const decodeCheckoutStatusSearchParams = getSearchParamsDecoder(
  Schema.Struct({
    outcome: Schema.optional(Schema.Literals(["success", "cancelled"])),
  })
);

export function CheckoutStatusRoute({
  params,
  searchParams,
  presentation = "page",
}: CheckoutStatusRouteProps) {
  return runWithRequestLocale((locale) => (
    <>
      <CheckoutPaymentWindowCoordinator />
      <Suspense
        fallback={
          <CheckoutStatusFallback locale={locale} presentation={presentation} />
        }
      >
        <CheckoutStatusContent
          params={params}
          presentation={presentation}
          searchParams={searchParams}
        />
      </Suspense>
    </>
  ));
}

async function CheckoutStatusContent({
  params,
  presentation,
  searchParams,
}: {
  readonly params: Promise<{ orderId: string }>;
  readonly presentation: CheckoutStatusPresentation;
  readonly searchParams: Promise<SearchParamsRecord>;
}) {
  const decodedParams = decodeCheckoutStatusParams(await params);
  const { orderId } = Option.getOrElse(decodedParams, () => notFound());

  return runWithRequestLocale(async (locale) => {
    await connection();
    switch (await loadOrderKind(orderId)) {
      case "pass-purchase":
        // Pass purchase orders have no status page yet.
        return notFound();
      case "reservation":
      case undefined:
        // Without an order row the reservation page still answers: it owns
        // not-found, the signed-out sign-in redirect, and review sandbox
        // orders, which have no order row.
        return renderReservationStatus({
          locale,
          orderId,
          presentation,
          searchParams,
        });
    }
  });
}

async function renderReservationStatus({
  locale,
  orderId,
  presentation,
  searchParams,
}: {
  readonly locale: Locale;
  readonly orderId: WorkspaceReservationId;
  readonly presentation: CheckoutStatusPresentation;
  readonly searchParams: Promise<SearchParamsRecord>;
}) {
  const cookieStore = await cookies();
  const requestHeaders = await headers();
  const accessCookie = readReservationAccessCookie(cookieStore, orderId);
  const rawSearchParams = await searchParams;
  const decodedSearchParams = Option.getOrElse(
    decodeCheckoutStatusSearchParams(rawSearchParams),
    () => ({ outcome: undefined })
  );
  const returnOutcome = decodedSearchParams.outcome ?? "unknown";
  const loadStatus = Effect.gen(function* () {
    const service = yield* CheckoutStatusService;
    const authorization = yield* ReservationAuthorizationService;
    return yield* loadCheckoutStatusPage(service, authorization, {
      accessCookie,
      locale,
      orderId,
      requestHeaders,
      returnOutcome,
    });
  }).pipe(
    Effect.tapError((cause) =>
      Effect.logError("Checkout status load failed", {
        orderId,
        returnOutcome,
        cause,
      })
    ),
    Effect.provide(
      Layer.mergeAll(
        CheckoutStatusService.Live,
        ReservationAuthorizationService.Live
      )
    )
  );
  const [status, withdrawal] = await Effect.all(
    [
      loadStatus,
      readReservationWithdrawalEntry({ reservationId: orderId, locale }),
    ],
    { concurrency: "unbounded" }
  ).pipe(runWorkspaceEffect("checkout.status.load"));
  // A signed-out visitor, such as one following the link in the author's
  // email, signs in and comes back instead of seeing "not found".
  if (status.status === "not_found" && (await isSignedOut())) {
    redirect(
      getReservationStatusSignInPath(
        locale,
        orderId,
        decodedSearchParams.outcome
      )
    );
  }
  return (
    <>
      <RouteAutoRefresh
        enabled={checkoutStatusTraits[status.status].autoRefresh}
      />
      <CheckoutStatusReferralCodeSettlement
        status={status.status}
        {...(status.status === "reservation_cancelled" && {
          paymentStatus: status.paymentStatus,
        })}
      />
      <CheckoutStatusPage
        locale={locale}
        presentation={presentation}
        status={status}
        withdrawal={
          withdrawal.status === "offered" && status.status !== "fulfilled"
            ? { status: "none" }
            : withdrawal
        }
      />
    </>
  );
}

const isSignedOut = () =>
  isStatusViewerSignedOut().pipe(
    Effect.provide(CurrentCustomerAccount.Live),
    runWorkspaceEffect("checkout.status.viewer")
  );

function CheckoutStatusFallback({
  locale,
  presentation,
}: {
  readonly locale: Locale;
  readonly presentation: CheckoutStatusPresentation;
}) {
  const skeleton = (
    <CheckoutStatusPageSkeleton locale={locale} presentation={presentation} />
  );

  if (presentation === "modal") return skeleton;

  return (
    <CheckoutFlowLayout activeStepKey="complete" locale={locale}>
      {skeleton}
    </CheckoutFlowLayout>
  );
}
