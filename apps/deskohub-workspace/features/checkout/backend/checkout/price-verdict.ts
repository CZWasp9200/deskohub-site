import { Match } from "effect";
import type { CheckoutSummaryChangedKeys } from "@/features/checkout/checkout-summary";

/**
 * What a price boundary concluded about the price the customer saw: it still
 * holds, or it changed and `changedKeys` names the checkout summary items
 * that moved. `priced` is the price the checkout continues with either way;
 * a boundary that continues with another kind of price when it changed names
 * it as `Repriced`. Each boundary applies its own change rule, and failures
 * that leave the price unknown, such as an unanswered discount provider, stay
 * errors.
 */
export type PriceVerdict<Priced, Repriced = Priced> =
  | {
      readonly status: "affirmed";
      readonly priced: Priced;
    }
  | {
      readonly status: "pricing_changed";
      readonly priced: Repriced;
      readonly changedKeys: CheckoutSummaryChangedKeys;
    };

/**
 * The checkout summary items a verdict says moved; `undefined` when the
 * price still holds.
 */
export const getPriceVerdictChangedKeys = (
  verdict: PriceVerdict<unknown>
): CheckoutSummaryChangedKeys | undefined =>
  Match.value(verdict).pipe(
    Match.discriminatorsExhaustive("status")({
      affirmed: () => undefined,
      pricing_changed: ({ changedKeys }) => changedKeys,
    })
  );
