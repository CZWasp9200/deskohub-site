import { Option } from "effect";
import type { CustomerReservationSummary } from "@/features/account/contracts";
import {
  type CoworkStay,
  getBookedCoworkStay,
} from "@/features/reservation/cowork-stay";
import { parseInstant } from "@/shared/utils/temporal";

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
  product.kind === "cowork"
    ? Option.all({
        startsAt: Option.flatMap(Option.fromNullishOr(startsAt), parseInstant),
        endsAt: Option.flatMap(Option.fromNullishOr(endsAt), parseInstant),
      }).pipe(
        Option.map((interval) =>
          getBookedCoworkStay({ tier: product.tier, interval })
        ),
        Option.getOrUndefined
      )
    : undefined;
