import { cn } from "@/shared/utils";
import type { AdministrationPaymentAttempt } from "./administration.service";
import {
  formatAdministrationDateTime,
  formatAdministrationMoney,
  getAdministrationPaymentStatus,
} from "./formatters";

type DisplayedPayment = Pick<
  AdministrationPaymentAttempt,
  | "amount"
  | "refundState"
  | "refundedAmount"
  | "refundedAt"
  | "stateLabel"
  | "updatedAt"
>;

/**
 * The paid amount, struck through once Nexi reports a refund. A partial refund
 * also shows the amount Deskohub keeps. The refund is spelled out for screen
 * readers, which do not announce the strikethrough.
 */
export function PaymentAmount({
  payment,
}: {
  readonly payment: DisplayedPayment;
}) {
  const status = getAdministrationPaymentStatus(payment);
  const amount = formatAdministrationMoney(payment.amount);
  if (!status.refunded) return amount;
  return (
    <>
      <del className="font-normal text-navy-blue/55 line-through">
        {amount}
        <span className="sr-only">
          {status.retainedAmount ? " before refund" : " refunded"}
        </span>
      </del>
      {status.retainedAmount && (
        <>
          {" "}
          {formatAdministrationMoney(status.retainedAmount)}
          <span className="sr-only"> after refund</span>
        </>
      )}
    </>
  );
}

/** The payment status and when it was reached, such as "Paid · 12 Oct 2026, 08:34". */
export function PaymentStatusText({
  payment,
}: {
  readonly payment: DisplayedPayment;
}) {
  const status = getAdministrationPaymentStatus(payment);
  return `${status.label} · ${formatAdministrationDateTime(status.at)}`;
}

export function PaymentRefundRequiredLabel({
  className,
  payment,
}: {
  readonly className?: string;
  readonly payment: DisplayedPayment;
}) {
  if (!getAdministrationPaymentStatus(payment).needsRefund) return null;
  return (
    <span
      className={cn("block font-semibold text-burned-orange-ink", className)}
    >
      Needs refund
    </span>
  );
}
