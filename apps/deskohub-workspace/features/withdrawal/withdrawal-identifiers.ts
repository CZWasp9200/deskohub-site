import { Schema } from "effect";

/** A recorded withdrawal from a contract. */
export const withdrawalIdSchema = Schema.String.pipe(
  Schema.brand("WithdrawalId")
);

export type WithdrawalId = typeof withdrawalIdSchema.Type;

/**
 * The product family a withdrawable contract belongs to. Each family that
 * offers withdrawal names itself here once; the withdrawal ledger stores it
 * with the family's own contract id.
 */
export type WithdrawableContractKind = "reservation";
