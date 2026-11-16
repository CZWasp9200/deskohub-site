import type { CustomerReservationSummary } from "@/features/account/contracts";
import {
  type CoworkStay,
  getBookedCoworkStay,
} from "@/features/reservation/cowork-stay";

/**
 * A cowork history entry's stay, read from its booked time, since nothing
 * stores it. `undefined` for another product, or while its time can't be read.
 */
export const getReservationSummaryStay = ({
  product,
  startsAt,
  endsAt,
}: Pick<CustomerReservationSummary, "endsAt" | "product" | "startsAt">):
  | CoworkStay
  | undefined =>
  product.kind === "cowork" && startsAt && endsAt
    ? getBookedCoworkStay({
        tier: product.tier,
        interval: {
          startsAt: Temporal.Instant.from(startsAt),
          endsAt: Temporal.Instant.from(endsAt),
        },
      })
    : undefined;
