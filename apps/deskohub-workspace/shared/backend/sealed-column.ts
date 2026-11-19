import { type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { Option } from "effect";
import { type DatabaseQueryError, findSqlState } from "@/db/sql-constraint";
import { sensitiveDatabaseParameter } from "@/shared/backend/logging/database-query-parameter-classifier";

/**
 * Text that PostgreSQL `pgcrypto` encrypts into a `bytea` column under a
 * passphrase. The plaintext and the passphrase reach the database only as
 * sensitive parameters. Every statement that seals or opens a column binds
 * the passphrase, so callers run it with tracing off and censor its failure.
 * The only callers are each record kind's declared sealer: the accounting
 * records (`sealedAccountingJson`) and reservation invitee addresses.
 */
const pgcryptoOptions = "cipher-algo=aes256,compress-algo=1,unicode-mode=1";

/** The ciphertext of `plaintext` under `passphrase`, for an insert or update. */
export const sealColumnText = (
  plaintext: string,
  passphrase: string
): SQL<Buffer> =>
  sql<Buffer>`pgp_sym_encrypt(${sensitiveDatabaseParameter(plaintext)}, ${sensitiveDatabaseParameter(passphrase)}, ${pgcryptoOptions})`;

/** The plaintext of a sealed column, selected with its row's passphrase. */
export const openSealedColumnText = (
  ciphertext: PgColumn,
  passphrase: string
): SQL<string> =>
  sql<string>`pgp_sym_decrypt(${ciphertext}, ${sensitiveDatabaseParameter(passphrase)})`;

const undecryptableSqlStates: ReadonlySet<string> = new Set([
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
 * Whether a failed opening statement failed on the sealed value itself:
 * pgcrypto, the only routine the statement calls, could not decrypt it with
 * the passphrase its row names, or decrypted it to invalid text. Anything
 * else, such as a timeout, a cancelled statement, a lost connection or a
 * refused privilege, is a database failure.
 */
export const isUndecryptableSealedColumn = (error: DatabaseQueryError) =>
  Option.exists(findSqlState(error), (sqlState) =>
    undecryptableSqlStates.has(sqlState)
  );
