import { Data, type Effect, type Option } from "effect";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { Locale } from "@/features/i18n";
import type { Money } from "@/shared/money/money";
import type {
  WithdrawalAssessment,
  WithdrawalRefundBasis,
} from "./withdrawal-assessment";
import type { WithdrawableContractKind } from "./withdrawal-identifiers";

/** Names one contract across product families. */
export type WithdrawableContractRef = {
  readonly kind: WithdrawableContractKind;
  /** The contract's id within its family, such as a reservation id. */
  readonly id: string;
};

/** A customer's contract as its family reads it for a withdrawal. */
export type WithdrawableContract = {
  readonly ref: WithdrawableContractRef;
  /** Identifies the contract in the statement and the receipt, in the locale read. */
  readonly label: string;
  readonly paidAmount: Money;
  /** The contract's withdrawal standing at `now`. */
  readonly assess: (now: Temporal.Instant) => WithdrawalAssessment;
};

/** What a family's cancellation acts on after a withdrawal was recorded. */
export type ContractCancellation = {
  readonly contractId: string;
  readonly refundAmount: Money;
  readonly refundBasis: WithdrawalRefundBasis;
};

/** A family couldn't read its contracts. Nothing was decided. */
export class WithdrawableContractUnavailableError extends Data.TaggedError(
  "WithdrawableContractUnavailableError"
)<{
  readonly kind: WithdrawableContractKind;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * A family couldn't end a withdrawn contract. `transient` failures may pass
 * on an immediate retry; every failure is retried later until it succeeds.
 */
export class ContractCancellationError extends Data.TaggedError(
  "ContractCancellationError"
)<{
  readonly kind: WithdrawableContractKind;
  /** A stable, low-cardinality code for logs and the administration. */
  readonly code: string;
  readonly transient: boolean;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * The port each product family that sells withdrawable contracts implements.
 * The withdrawal service owns everything shared: the record, the receipt and
 * operator emails, retries and the read model. A family only reads its
 * contracts, assesses them, and ends one after a recorded withdrawal.
 */
export interface WithdrawableContractFamily {
  readonly kind: WithdrawableContractKind;
  /**
   * The account's contract, absent when it doesn't exist or the account may
   * not withdraw from it (it didn't conclude it).
   */
  readonly find: (input: {
    readonly contractId: string;
    readonly accountId: CustomerAccountId;
    readonly locale: Locale;
  }) => Effect.Effect<
    Option.Option<WithdrawableContract>,
    WithdrawableContractUnavailableError
  >;
  /**
   * Ends the contract after its withdrawal was recorded: stops the service
   * and marks what the payment owes back. Repeating it after it succeeded,
   * or after it failed part way, must be safe.
   */
  readonly cancel: (
    cancellation: ContractCancellation
  ) => Effect.Effect<void, ContractCancellationError>;
}
