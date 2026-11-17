import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { Locale } from "@/features/i18n";
import type { WithdrawalRefundUnit } from "@/features/withdrawal/withdrawal-assessment";
import type {
  WithdrawableContractKind,
  WithdrawalId,
} from "@/features/withdrawal/withdrawal-identifiers";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";
import { customerAccounts } from "./customer-accounts";

/**
 * Consumers' withdrawals from contracts submitted through the online
 * withdrawal function, one per contract. A row is the durable record of the
 * statement and the work it owes: the receipt to the customer, the operator
 * notice and the contract's cancellation, each stamped once done. Settlement
 * retries unfinished rows until all three are done. The receipt address isn't
 * stored; it's the account's login email when the receipt is sent.
 */
export const contractWithdrawals = pgTable(
  "contract_withdrawals",
  {
    id: text("id").primaryKey().default(postgresUuidV7).$type<WithdrawalId>(),
    contractKind: text("contract_kind")
      .notNull()
      .$type<WithdrawableContractKind>(),
    /** The contract's id within its family, such as a reservation id. */
    contractId: text("contract_id").notNull(),
    // Accounts survive deletion as tombstones, so production never cascades;
    // only test cleanup hard-deletes accounts.
    customerAccountId: text("customer_account_id")
      .notNull()
      .references(() => customerAccounts.id, { onDelete: "cascade" })
      .$type<CustomerAccountId>(),
    /** The language the customer withdrew in, for the receipt. */
    locale: text("locale").notNull().$type<Locale>(),
    /** How the statement identified the contract, in `locale`. */
    contractLabel: text("contract_label").notNull(),
    submittedAt: instant("submitted_at").notNull(),
    periodEndsAt: instant("period_ends_at").notNull(),
    paidAmountValue: integer("paid_amount_value").notNull(),
    refundAmountValue: integer("refund_amount_value").notNull(),
    amountExponent: integer("amount_exponent").notNull(),
    currency: text("currency").notNull(),
    /** Set with the unit counts when the refund is a share of the payment. */
    refundUnit: text("refund_unit").$type<WithdrawalRefundUnit>(),
    refundUnstartedUnits: integer("refund_unstarted_units"),
    refundTotalUnits: integer("refund_total_units"),
    receiptSentAt: instant("receipt_sent_at"),
    operatorNotifiedAt: instant("operator_notified_at"),
    contractCancelledAt: instant("contract_cancelled_at"),
    /** When the receipt, the notice and the cancellation were all done. */
    settledAt: instant("settled_at"),
    /** Fences one settlement run; a stale claim may be taken over. */
    settlementClaimedAt: instant("settlement_claimed_at"),
    settlementAttempts: integer("settlement_attempts").notNull().default(0),
    /** The last failed step's code, kept until settlement succeeds. */
    settlementFailureCode: text("settlement_failure_code"),
    nextSettlementAt: instant("next_settlement_at")
      .notNull()
      .default(sql`now()`),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("contract_withdrawals_contract_unique_idx").on(
      t.contractKind,
      t.contractId
    ),
    index("contract_withdrawals_customer_account_idx").on(t.customerAccountId),
    index("contract_withdrawals_unsettled_idx")
      .on(t.nextSettlementAt)
      .where(sql`${t.settledAt} is null`),
    check(
      "contract_withdrawals_amount_check",
      sql`${t.paidAmountValue} >= 0 and ${t.refundAmountValue} >= 0 and ${t.refundAmountValue} <= ${t.paidAmountValue} and ${t.amountExponent} >= 0 and ${t.currency} ~ '^[A-Z]{3}$'`
    ),
    check(
      "contract_withdrawals_refund_basis_check",
      sql`(${t.refundUnit} is null and ${t.refundUnstartedUnits} is null and ${t.refundTotalUnits} is null and ${t.refundAmountValue} = ${t.paidAmountValue}) or (${t.refundUnit} in ('day', 'hour') and ${t.refundUnstartedUnits} > 0 and ${t.refundTotalUnits} > ${t.refundUnstartedUnits})`
    ),
    check(
      "contract_withdrawals_settled_check",
      sql`${t.settledAt} is null or (${t.receiptSentAt} is not null and ${t.operatorNotifiedAt} is not null and ${t.contractCancelledAt} is not null)`
    ),
    check(
      "contract_withdrawals_contract_check",
      sql`btrim(${t.contractKind}) <> '' and btrim(${t.contractId}) <> ''`
    ),
  ]
);

export type ContractWithdrawalRow = typeof contractWithdrawals.$inferSelect;
