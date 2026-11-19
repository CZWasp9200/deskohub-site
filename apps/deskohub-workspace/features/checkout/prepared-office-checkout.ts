import type { OfficeReservationDetails } from "@/features/reservation/office-reservation";
import type { Money } from "@/shared/money/money";

/** The public selection and price of an actual prepared office hold. */
export type PreparedOfficeCheckout = Pick<
  OfficeReservationDetails,
  "startsOn" | "endsOn" | "seats"
> & {
  readonly total: Money;
  /** Simulated holds store the advertised total only. */
  readonly regularPrice?: Money;
  readonly discount?: Money;
};
