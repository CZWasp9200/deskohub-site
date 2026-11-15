import { eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { accountingDocumentSnapshots } from "@/db/schema";
import {
  type AccountingDocumentSnapshot,
  accountingDocumentSnapshotSchema,
  encodeStoredAccountingDocumentSnapshot,
} from "@/features/accounting/accounting-document-snapshot";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import {
  type AccountingRecordUnavailable,
  sealedAccountingJson,
} from "./sealed-accounting-json";

/** Payment-time source snapshots, sealed one per payment attempt. */
export const sealedAccountingDocumentSnapshots = sealedAccountingJson({
  label: "Accounting snapshot",
  table: accountingDocumentSnapshots,
  keyId: accountingDocumentSnapshots.keyId,
  ciphertext: accountingDocumentSnapshots.encryptedSnapshot,
  plaintext: {},
  encode: (snapshot: AccountingDocumentSnapshot) =>
    encodeStoredAccountingDocumentSnapshot(snapshot),
  schema: accountingDocumentSnapshotSchema,
});

export interface IAccountingDocumentSnapshotRepository {
  readonly findByPaymentAttemptId: (
    paymentAttemptId: PaymentAttemptId
  ) => Effect.Effect<
    AccountingDocumentSnapshot | null,
    AccountingRecordUnavailable | EffectDrizzleQueryError
  >;
}

export class AccountingDocumentSnapshotRepository extends Context.Service<
  AccountingDocumentSnapshotRepository,
  IAccountingDocumentSnapshotRepository
>()("@deskohub-workspace/accounting/AccountingDocumentSnapshotRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const snapshots = yield* sealedAccountingDocumentSnapshots;

      return {
        findByPaymentAttemptId: Effect.fn(
          "AccountingDocumentSnapshotRepository.findByPaymentAttemptId"
        )(function* (paymentAttemptId: PaymentAttemptId) {
          const opened = yield* snapshots.open({
            reference: { type: "paymentAttemptId", id: paymentAttemptId },
            where: eq(
              accountingDocumentSnapshots.paymentAttemptId,
              paymentAttemptId
            ),
          });
          return opened?.value ?? null;
        }),
      } satisfies IAccountingDocumentSnapshotRepository;
    })
  );
}
