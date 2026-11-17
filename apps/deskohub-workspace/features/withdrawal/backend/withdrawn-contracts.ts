import { type AnyColumn, type SQL, sql } from "drizzle-orm";
import { contractWithdrawals } from "@/db/schema";
import type { WithdrawableContractKind } from "../withdrawal-identifiers";

/**
 * Whether the family's contract in `contractId` has a recorded withdrawal
 * that owes the whole payment back, as SQL for a query over that family's
 * contracts. A partial refund means the service had started, so it never
 * counts.
 */
export const isWithdrawnInFull = (
  kind: WithdrawableContractKind,
  contractId: AnyColumn | SQL
): SQL =>
  sql`exists (select 1 from ${contractWithdrawals} where ${contractWithdrawals.contractKind} = ${kind} and ${contractWithdrawals.contractId} = ${contractId} and ${contractWithdrawals.refundUnit} is null)`;
