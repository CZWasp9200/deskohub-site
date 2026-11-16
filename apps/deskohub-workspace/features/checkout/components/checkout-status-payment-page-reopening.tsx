"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { reopenPaymentPage } from "@/features/checkout/actions/reopen-payment-page";
import { CheckoutBanner } from "@/features/checkout/components/checkout-banner";
import { openCheckoutPaymentWindow } from "@/features/checkout/components/checkout-payment-window";
import { type Locale, m } from "@/features/i18n";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { Button } from "@/shared/components/ui/button";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";

/**
 * The status page's action row led by a button that opens the order's
 * payment page again, as the Pay page opened it: in a new tab whose return
 * this status tab owns, or in this tab when the browser blocks the new one.
 * Its failure shows in an alert region that stays mounted.
 * A page that can no longer open refreshes the status instead.
 */
export function CheckoutStatusPaymentPageReopening({
  children,
  className,
  locale,
  orderId,
}: {
  readonly children?: ReactNode;
  readonly className: string;
  readonly locale: Locale;
  readonly orderId: WorkspaceReservationId;
}) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const showError = () =>
    setErrorMessage(m.checkoutStatusOpenPaymentPageError({}, { locale }));
  const { execute, isExecuting } = useWorkspaceAction(reopenPaymentPage, {
    onSuccess: ({ data }) => {
      if (!data) {
        showError();
        return;
      }
      if (data.state !== "opened") {
        router.refresh();
        return;
      }
      // This status page's coordinator already holds the payment's return.
      if (!openCheckoutPaymentWindow(data.providerRedirectUrl)) {
        router.push(data.providerRedirectUrl);
      }
    },
    onError: ({ error }) => {
      setErrorMessage(
        error.serverError ||
          m.checkoutStatusOpenPaymentPageError({}, { locale })
      );
    },
    onTransportError: showError,
  });

  const open = () => {
    if (isExecuting) return;
    setErrorMessage(null);
    execute({ locale, orderId });
  };

  return (
    <>
      <div className={className}>
        <Button
          id="checkout-status-open-payment-page"
          onClick={open}
          pending={isExecuting}
          size="lg"
          type="button"
        >
          {m.checkoutStatusOpenPaymentPage({}, { locale })}
        </Button>
        {children}
      </div>
      <div role="alert">
        {!!errorMessage && (
          <div className="mt-4">
            <CheckoutBanner live={false}>{errorMessage}</CheckoutBanner>
          </div>
        )}
      </div>
    </>
  );
}
