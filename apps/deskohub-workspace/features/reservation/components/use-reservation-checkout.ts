"use client";

import { track } from "@vercel/analytics/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  type CheckoutSessionId,
  createCheckoutAttemptId,
  createCheckoutSessionId,
} from "@/features/checkout/checkout-identifiers";
import type { PreparedOfficeCheckout } from "@/features/checkout/prepared-office-checkout";
import { visitorConsent } from "@/features/cookie-consent";
import { captureAnalyticsEvent } from "@/features/cookie-consent/analytics-events";
import { type Locale, m } from "@/features/i18n";
import type { OfficePeople } from "@/features/office/office-people";
import { preparePayState } from "@/features/reservation/actions/prepare-pay-state";
import {
  getReservationAnalyticsProperties,
  type ReservationPrePaymentOutcome,
} from "@/features/reservation/reservation-analytics";
import type { ReservationOrderIssuanceData } from "@/features/reservation/reservation-order";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";

type ReservationCheckoutDetails = {
  readonly advertisedPriceToken: string;
  readonly customer?: "account";
  readonly marketingConsent?: boolean;
  /** Labels a `marketingConsent: true` given through a site tool. */
  readonly marketingConsentSource?: "site_tool";
  readonly people?: OfficePeople;
  readonly reservation: ReservationOrderIssuanceData;
};

type PreparedCheckout = {
  readonly status: "ready" | "pricing_changed";
  readonly redirectUrl: string;
  /** When the Pay page stops accepting the prepared state. */
  readonly expiresAt: string;
  readonly preparedOffice?: PreparedOfficeCheckout;
};

/** Where a checkout submission led: the prepared Pay page or an error message. */
export type CheckoutSubmission =
  | PreparedCheckout
  | { readonly status: "error"; readonly message: string };

type UseReservationCheckoutOptions = {
  readonly initialCheckoutSessionId?: CheckoutSessionId;
  readonly locale: Locale;
};

export function useReservationCheckout({
  initialCheckoutSessionId,
  locale,
}: UseReservationCheckoutOptions) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasTrackedSuccessfulSubmission = useRef(false);
  const lastSubmittedReservationRef = useRef<string | null>(null);
  const [checkoutSessionId] = useState(
    () => initialCheckoutSessionId ?? createCheckoutSessionId()
  );
  const [checkoutAttemptId, setCheckoutAttemptId] = useState(
    createCheckoutAttemptId
  );
  const [submissionError, setSubmissionError] = useState<string>();
  const analyticsProperties = useMemo(
    () => getReservationAnalyticsProperties(searchParams),
    [searchParams]
  );
  const capturePrePaymentOutcome = useCallback(
    (outcome: ReservationPrePaymentOutcome) => {
      if (!visitorConsent.accepts("analytics")) return;
      captureAnalyticsEvent("pre-payment outcome", { outcome });
    },
    []
  );
  const {
    executeAsync: prepareCheckout,
    input,
    isExecuting,
    result,
  } = useWorkspaceAction(preparePayState, {
    onSuccess: ({ data, input }) => {
      if (data?.status === "error") {
        setSubmissionError(data.message);
        return;
      }

      const prepared = getPreparedCheckout(data, input.reservation);
      if (!prepared) {
        setSubmissionError(m.reservationErrorMessage({}, { locale }));
        return;
      }

      if (
        !hasTrackedSuccessfulSubmission.current &&
        visitorConsent.accepts("analytics")
      ) {
        hasTrackedSuccessfulSubmission.current = true;
        track("workspace_checkout_started", analyticsProperties);
      }

      router.push(prepared.redirectUrl);
    },
    onError: ({ error }) => {
      setSubmissionError(
        error.serverError || m.reservationErrorMessage({}, { locale })
      );
    },
    onTransportError: () => {
      capturePrePaymentOutcome("transport_error");
      setSubmissionError(m.reservationErrorMessage({}, { locale }));
    },
  });
  const preparedCheckout = getPreparedCheckout(result.data, input?.reservation);
  const hasPreparedPayRedirect = preparedCheckout !== undefined;
  const failedCheckout = (message?: string): CheckoutSubmission => ({
    status: "error",
    message: message || m.reservationErrorMessage({}, { locale }),
  });

  const startCheckout = async (
    details: ReservationCheckoutDetails
  ): Promise<CheckoutSubmission> => {
    if (preparedCheckout) return preparedCheckout;

    setSubmissionError(undefined);
    hasTrackedSuccessfulSubmission.current = false;
    window.scrollTo({ top: 0, behavior: "instant" });

    const reservationFingerprint = JSON.stringify([
      details.reservation,
      details.people,
    ]);
    const effectiveCheckoutAttemptId =
      lastSubmittedReservationRef.current &&
      lastSubmittedReservationRef.current !== reservationFingerprint
        ? createCheckoutAttemptId()
        : checkoutAttemptId;
    if (effectiveCheckoutAttemptId !== checkoutAttemptId) {
      setCheckoutAttemptId(effectiveCheckoutAttemptId);
    }
    lastSubmittedReservationRef.current = reservationFingerprint;

    const identifiers = {
      checkoutAttemptId: effectiveCheckoutAttemptId,
      checkoutSessionId,
      locale,
    };
    // The action callbacks above update the page; the returned submission
    // reports the same outcome to callers such as a site tool.
    return prepareCheckout({ ...details, ...identifiers }).then(
      ({ data, serverError }) =>
        data?.status === "error"
          ? failedCheckout(data.message)
          : (getPreparedCheckout(data, details.reservation) ??
            failedCheckout(serverError)),
      () => failedCheckout()
    );
  };

  return {
    capturePrePaymentOutcome,
    clearSubmissionError: () => setSubmissionError(undefined),
    hasPreparedPayRedirect,
    isPreparingCheckout: isExecuting || hasPreparedPayRedirect,
    preparedCheckout,
    isSubmittingCheckout: isExecuting,
    setSubmissionError,
    startCheckout,
    submissionError,
  };
}

const getPreparedCheckout = (
  data:
    | {
        readonly status: string;
        readonly redirectUrl?: string;
        readonly expiresAt?: string;
        readonly preparedOffice?: PreparedOfficeCheckout;
      }
    | undefined,
  reservation: Parameters<typeof preparePayState>[0]["reservation"] | undefined
): PreparedCheckout | undefined => {
  if (
    !reservation ||
    (data?.status !== "ready" && data?.status !== "pricing_changed") ||
    !data.redirectUrl ||
    !data.expiresAt
  ) {
    return undefined;
  }
  const { preparedOffice } = data;
  if (
    reservation.kind === "office" &&
    (!preparedOffice ||
      preparedOffice.startsOn !== reservation.startsOn ||
      preparedOffice.endsOn !== reservation.endsOn ||
      preparedOffice.seats !== reservation.seats)
  ) {
    return undefined;
  }
  return {
    status: data.status,
    redirectUrl: data.redirectUrl,
    expiresAt: data.expiresAt,
    ...(preparedOffice && { preparedOffice }),
  };
};
