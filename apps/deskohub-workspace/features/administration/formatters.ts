import {
  temporalInstantToDate,
  temporalPlainDateToDate,
  workspaceSiteConstants,
} from "@/shared/utils";
import type {
  AdministrationMoney,
  AdministrationPaymentAttempt,
  AdministrationReservationSummary,
} from "./administration.service";

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: workspaceSiteConstants.location.timeZone,
});

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: workspaceSiteConstants.location.timeZone,
});

export const formatAdministrationDateTime = (value: string) =>
  dateTimeFormatter.format(temporalInstantToDate(Temporal.Instant.from(value)));

export const formatAdministrationPlainDate = (value: string) =>
  dateFormatter.format(
    temporalPlainDateToDate({
      date: Temporal.PlainDate.from(value),
      plainTime: Temporal.PlainTime.from("12:00"),
      timeZone: workspaceSiteConstants.location.timeZone,
    })
  );

export const formatAdministrationReservationDate = (
  reservation: Pick<
    AdministrationReservationSummary,
    "date" | "startsAt" | "type"
  >
) => {
  if (reservation.type === "cowork" && reservation.date) {
    return formatAdministrationPlainDate(reservation.date);
  }
  if (reservation.startsAt) {
    return formatAdministrationDateTime(reservation.startsAt);
  }
  return reservation.date
    ? formatAdministrationPlainDate(reservation.date)
    : null;
};

export const formatAdministrationMoney = ({
  currency,
  exponent,
  value,
}: {
  readonly currency: string;
  readonly exponent: number;
  readonly value: number;
}) =>
  new Intl.NumberFormat("en-GB", {
    currency,
    style: "currency",
  }).format(value / 10 ** exponent);

export type AdministrationPaymentStatus = {
  /** "Paid", "Refunded", or "Partially refunded" with the refunded amount. */
  readonly label: string;
  /** When the payment reached this status: the refund time once refunded. */
  readonly at: string;
  readonly refunded: boolean;
  /** The amount Deskohub keeps after a partial refund. */
  readonly retainedAmount: AdministrationMoney | null;
  /** The payment still has to be refunded in the Nexi back office. */
  readonly needsRefund: boolean;
};

/**
 * The payment status operators see. A recorded Nexi refund, full or partial,
 * replaces the attempt state, because the money is no longer held.
 */
export const getAdministrationPaymentStatus = (
  attempt: Pick<
    AdministrationPaymentAttempt,
    | "amount"
    | "refundState"
    | "refundedAmount"
    | "refundedAt"
    | "stateLabel"
    | "updatedAt"
  >
): AdministrationPaymentStatus => {
  const { refundedAmount, refundedAt } = attempt;
  if (attempt.refundState !== "refunded" || !refundedAmount || !refundedAt) {
    return {
      label: attempt.stateLabel,
      at: attempt.updatedAt,
      refunded: false,
      retainedAmount: null,
      needsRefund: attempt.refundState === "required",
    };
  }
  const partial = refundedAmount.value < attempt.amount.value;
  return {
    label: partial
      ? `Partially refunded ${formatAdministrationMoney(refundedAmount)}`
      : "Refunded",
    at: refundedAt,
    refunded: true,
    retainedAmount: partial
      ? {
          ...attempt.amount,
          value: attempt.amount.value - refundedAmount.value,
        }
      : null,
    needsRefund: false,
  };
};
