import type { NexiOrderId } from "@deskohub/nexi";
import { type SQL, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { SelectResultFields } from "drizzle-orm/query-builders/select.types";
import { Data, Effect, Option, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { type DatabaseQueryError, findSqlState } from "@/db/sql-constraint";
import type { AccountingSnapshotKeyId } from "@/features/accounting/accounting-document-snapshot";
import type { InvoiceId } from "@/features/accounting/manual-invoice";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  censorDatabaseQueryError,
  censorLogValue,
} from "@/shared/backend/logging/censorship";
import { sensitiveDatabaseParameter } from "@/shared/backend/logging/database-query-parameter-classifier";
import { AccountingSnapshotKeyService } from "./accounting-snapshot-key.service";

/** The id an accounting record was sealed or looked up by, and what it is. */
export type AccountingRecordReference =
  | { readonly type: "invoiceId"; readonly id: InvoiceId }
  | { readonly type: "paymentAttemptId"; readonly id: PaymentAttemptId }
  | { readonly type: "providerOrderId"; readonly id: NexiOrderId }
  | {
      readonly type: "workspaceReservationId";
      readonly id: WorkspaceReservationId;
    };

/**
 * An accounting record that can't be sealed, opened or trusted. `cause`, when
 * present, is already censored: no SQL text, parameter, key or plaintext.
 */
export class AccountingRecordUnavailable extends Data.TaggedError(
  "AccountingRecordUnavailable"
)<{
  readonly operation: "decrypt" | "encrypt" | "load" | "parse" | "validate";
  readonly reference: AccountingRecordReference;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** The columns an insert stores for one sealed record. */
interface SealedAccountingColumns {
  readonly keyId: AccountingSnapshotKeyId;
  readonly ciphertext: SQL<Buffer>;
}

/** Seals records under the active key it was made with. */
export interface AccountingRecordSealer<A> {
  /**
   * Hands `insert` the record's sealed columns and runs it with tracing off;
   * any failure of the insert becomes an encrypt failure.
   */
  readonly seal: <X, E, R>(input: {
    readonly reference: AccountingRecordReference;
    readonly value: A;
    readonly insert: (
      sealed: SealedAccountingColumns
    ) => Effect.Effect<X, E, R>;
  }) => Effect.Effect<X, AccountingRecordUnavailable, R>;
}

interface OpenedAccountingRecord<A, Plaintext> {
  readonly value: A;
  /** The record's plaintext columns, read in the statement that decrypts it. */
  readonly plaintext: Plaintext;
}

interface SealedAccountingJson<A, Plaintext> {
  /**
   * Takes the active key, so a caller can refuse before it writes anything.
   */
  readonly sealer: (
    reference: AccountingRecordReference
  ) => Effect.Effect<AccountingRecordSealer<A>, AccountingRecordUnavailable>;
  /**
   * Decrypts the one row `where` selects with the key its `key_id` names and
   * decodes it strictly. No row reads as `null`.
   */
  readonly open: (input: {
    readonly reference: AccountingRecordReference;
    readonly where: SQL;
  }) => Effect.Effect<
    OpenedAccountingRecord<A, Plaintext> | null,
    AccountingRecordUnavailable | EffectDrizzleQueryError
  >;
}

const pgcryptoOptions = "cipher-algo=aes256,compress-algo=1,unicode-mode=1";

const encryptJson = (json: string, secret: string): SQL<Buffer> =>
  sql<Buffer>`pgp_sym_encrypt(${sensitiveDatabaseParameter(json)}, ${sensitiveDatabaseParameter(secret)}, ${pgcryptoOptions})`;

const decryptJson = (ciphertext: PgColumn, secret: string): SQL<string> =>
  sql<string>`pgp_sym_decrypt(${ciphertext}, ${sensitiveDatabaseParameter(secret)})`;

const undecryptableRecordSqlStates: ReadonlySet<string> = new Set([
  // pgcrypto raises each failure to decrypt, such as a wrong key, corrupt
  // data or a message sealed as binary, as
  // external_routine_invocation_exception.
  "39000",
  // Decrypted text that isn't valid in the database encoding
  // (character_not_in_repertoire, untranslatable_character). Its message
  // quotes the offending bytes of the plaintext.
  "22021",
  "22P05",
]);

/**
 * Whether a failed decrypting statement failed on the sealed record itself:
 * pgcrypto, the only routine the statement calls, could not decrypt it with
 * the key its row names, or decrypted it to invalid text. Anything else, such
 * as a timeout, a cancelled statement, a lost connection or a refused
 * privilege, is a database failure.
 */
export const isUndecryptableRecord = (error: DatabaseQueryError) =>
  Option.exists(findSqlState(error), (sqlState) =>
    undecryptableRecordSqlStates.has(sqlState)
  );

/**
 * Stores values of one kind as versionless JSON that PostgreSQL `pgcrypto`
 * encrypts. Keys and plaintext reach the database only as sensitive
 * parameters, and the encrypting and decrypting statements run untraced.
 */
export const sealedAccountingJson = <
  A,
  const Plaintext extends Record<string, PgColumn>,
>(record: {
  /** Names the record in error messages, such as "Invoice". */
  readonly label: string;
  readonly table: PgTable;
  readonly keyId: PgColumn & {
    readonly _: {
      readonly data: AccountingSnapshotKeyId;
      readonly notNull: true;
    };
  };
  readonly ciphertext: PgColumn;
  /** Columns read beside the ciphertext, in this order. */
  readonly plaintext: Plaintext;
  /** The JSON form of a value; `JSON.stringify` writes it as stored. */
  readonly encode: (value: A) => unknown;
  /** Decodes stored JSON strictly: an unknown property is invalid. */
  readonly schema: Schema.Decoder<A>;
}) =>
  Effect.gen(function* () {
    const { db } = yield* WorkspaceDatabase;
    const keys = yield* AccountingSnapshotKeyService;
    const decode = Schema.decodeUnknownEffect(record.schema, {
      onExcessProperty: "error",
    });

    const unavailable = (
      reference: AccountingRecordReference,
      operation: AccountingRecordUnavailable["operation"],
      message: string
    ) =>
      new AccountingRecordUnavailable({
        operation,
        reference,
        message: `${record.label} ${message}`,
      });

    // The censored cause keeps the failure's classification, never its SQL,
    // parameters, key or plaintext.
    const unavailableBecause =
      (
        reference: AccountingRecordReference,
        operation: AccountingRecordUnavailable["operation"],
        message: string
      ) =>
      <Cause>(cause: Cause) =>
        new AccountingRecordUnavailable({
          operation,
          reference,
          message: `${record.label} ${message}`,
          cause: censorLogValue(cause),
        });

    const sealer = (reference: AccountingRecordReference) =>
      keys.getActive.pipe(
        Effect.mapError(
          unavailableBecause(
            reference,
            "encrypt",
            "encryption key is unavailable."
          )
        ),
        Effect.map(
          (key): AccountingRecordSealer<A> => ({
            seal: (input) =>
              Effect.suspend(() =>
                input.insert({
                  keyId: key.id,
                  ciphertext: encryptJson(
                    JSON.stringify(record.encode(input.value)),
                    key.secret
                  ),
                })
              ).pipe(
                Effect.withTracerEnabled(false),
                Effect.mapError(
                  unavailableBecause(
                    input.reference,
                    "encrypt",
                    "could not be encrypted."
                  )
                )
              ),
          })
        )
      );

    const open = Effect.fnUntraced(function* (input: {
      readonly reference: AccountingRecordReference;
      readonly where: SQL;
    }) {
      const [metadata] = yield* db
        .select({ keyId: record.keyId })
        .from(record.table)
        .where(input.where)
        .limit(1);

      if (!metadata) return null;

      const key = yield* keys
        .getById(metadata.keyId)
        .pipe(
          Effect.mapError(
            unavailableBecause(
              input.reference,
              "decrypt",
              "decryption key is unavailable."
            )
          )
        );

      // A nested selection keeps the flat column list: the plaintext columns
      // in order, then the decrypted JSON.
      const [row] = yield* db
        .select({
          plaintext: record.plaintext,
          sealedJson: decryptJson(record.ciphertext, key.secret),
        })
        .from(record.table)
        .where(input.where)
        .limit(1)
        .pipe(
          Effect.withTracerEnabled(false),
          // The statement binds the key, so a database failure leaves with
          // its parameters censored.
          Effect.mapError((error) =>
            isUndecryptableRecord(error)
              ? unavailableBecause(
                  input.reference,
                  "decrypt",
                  "could not be decrypted."
                )(error)
              : censorDatabaseQueryError(error)
          )
        );

      if (!row) {
        return yield* unavailable(
          input.reference,
          "load",
          "disappeared while loading."
        );
      }

      const encoded = yield* Effect.try({
        try: () => JSON.parse(row.sealedJson) as unknown,
        catch: () => unavailable(input.reference, "parse", "JSON is invalid."),
      });
      const value = yield* decode(encoded).pipe(
        Effect.mapError(() =>
          unavailable(input.reference, "parse", "schema is invalid.")
        )
      );

      return {
        value,
        // Drizzle leaves a nested selection without columns out of the row.
        plaintext: (row.plaintext ?? {}) as SelectResultFields<Plaintext>,
      } satisfies OpenedAccountingRecord<A, SelectResultFields<Plaintext>>;
    });

    return { sealer, open } satisfies SealedAccountingJson<
      A,
      SelectResultFields<Plaintext>
    >;
  });
