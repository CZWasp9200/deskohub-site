import { eq, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { customerLocalePreferences } from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import type { Locale } from "@/features/i18n";
import {
  CustomerAccountAccessError,
  type CustomerAccountId,
  mapCustomerAccountFailure,
} from "../customer-account";
import { requireAccountActivity } from "./customer-account-activity";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import {
  type CustomerAccountSession,
  CustomerAuthentication,
} from "./customer-authentication.service";

/**
 * The durable, Workspace-owned language preference of one customer account.
 * It is also the signed-in site locale. An account created before
 * preferences existed has none until its next sign-in or an explicit save.
 */
export interface ICustomerLocalePreferenceRepository {
  readonly save: (
    accountId: CustomerAccountId,
    locale: Locale
  ) => Effect.Effect<void, CustomerAccountAccessError>;
}

/**
 * Folds every non-access failure of the guarded save — the advisory lock
 * itself and the upsert — into one fixed, non-PII write cause. Access
 * failures raised by the under-lock session recheck and the
 * deletion-authority recheck pass through unchanged.
 */
const mapPreferenceSaveFailure = mapCustomerAccountFailure(
  "account-locale-preference.write"
);

/**
 * Fails the save unless the authoritative verified session read under the
 * account lock still belongs to the locked account. A missing session or a
 * session for another account maps to the fixed non-PII `unauthenticated`
 * access error, matching the action's pre-lock session guard.
 */
const requireSessionForAccount = (
  authentication: {
    readonly currentUser: Effect.Effect<
      CustomerAccountSession | null,
      CustomerAccountAccessError
    >;
  },
  accountId: CustomerAccountId
): Effect.Effect<CustomerAccountSession, CustomerAccountAccessError> =>
  Effect.flatMap(authentication.currentUser, (session) =>
    session?.accountId === accountId
      ? Effect.succeed(session)
      : Effect.fail(
          new CustomerAccountAccessError({ reason: "unauthenticated" })
        )
  );

export class CustomerLocalePreferenceRepository extends Context.Service<
  CustomerLocalePreferenceRepository,
  ICustomerLocalePreferenceRepository
>()("@deskohub-workspace/account/CustomerLocalePreferenceRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const links = yield* CustomerAccountLinkRepository;
      const authentication = yield* CustomerAuthentication;

      const save = (accountId: CustomerAccountId, locale: Locale) =>
        links
          .withAccountLock(
            accountId,
            // The session is re-read only after the lock is held, so a
            // session that expires or is revoked while the saver waits can
            // never write. Verified email and session liveness are enforced
            // by the authoritative read itself.
            requireSessionForAccount(authentication, accountId).pipe(
              Effect.andThen(() =>
                requireAccountActivity(links, accountId).pipe(
                  Effect.andThen(
                    db
                      .insert(customerLocalePreferences)
                      .values({ customerAccountId: accountId, locale })
                      .onConflictDoUpdate({
                        target: customerLocalePreferences.customerAccountId,
                        set: { locale, updatedAt: sql`now()` },
                      })
                  )
                )
              )
            )
          )
          .pipe(Effect.asVoid, Effect.mapError(mapPreferenceSaveFailure));

      return { save } satisfies ICustomerLocalePreferenceRepository;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        WorkspaceDatabase.Default,
        CustomerAccountLinkRepository.Live,
        CustomerAuthentication.Default
      )
    )
  );
}

/**
 * The closed outcome of the pre-delivery magic-link locale lookup. Only a
 * verified existing account with a saved preference yields a locale; every
 * other shape stays distinguishable so the caller can choose its fallback.
 */
export type MagicLinkLocaleLookup =
  | { readonly kind: "pre-account" }
  | { readonly kind: "unverified-email" }
  | { readonly kind: "account"; readonly locale: Locale }
  | { readonly kind: "account-locale-missing" }
  | { readonly kind: "read-failed" };

/**
 * Resolves the magic-link email locale for one recipient address from the
 * authoritative Better Auth user and its saved preference, if any. The
 * lookup never fails: an operational read failure is its own outcome so the
 * delivery path can distinguish it from a recipient without an account.
 */
const lookupMagicLinkDeliveryLocaleEffect = Effect.fn(
  "CustomerLocalePreferenceRepository.lookupMagicLinkDeliveryLocale"
)(function* (email: string) {
  const workspace = yield* WorkspaceDatabase;
  const rows = yield* workspace.db
    .select({
      id: authUser.id,
      emailVerified: authUser.emailVerified,
      locale: customerLocalePreferences.locale,
    })
    .from(authUser)
    .leftJoin(
      customerLocalePreferences,
      eq(customerLocalePreferences.customerAccountId, authUser.id)
    )
    .where(eq(authUser.email, email))
    .limit(1);
  const row = rows[0];
  if (!row) return { kind: "pre-account" } as const;
  if (!row.emailVerified) {
    return { kind: "unverified-email" } as const;
  }
  if (!row.locale) {
    return { kind: "account-locale-missing" } as const;
  }
  return { kind: "account", locale: row.locale } as const;
});

export const lookupMagicLinkDeliveryLocale = (
  email: string
): Effect.Effect<MagicLinkLocaleLookup, never, WorkspaceDatabase> =>
  lookupMagicLinkDeliveryLocaleEffect(email).pipe(
    Effect.orElseSucceed(() => ({ kind: "read-failed" }) as const)
  );

/**
 * Inserts the preference row only when the account has none, so a retried
 * or racing creation or sign-in never overwrites a saved preference.
 */
export const seedAccountLocalePreference = (
  accountId: CustomerAccountId,
  locale: Locale
): Effect.Effect<void, EffectDrizzleQueryError, WorkspaceDatabase> =>
  Effect.flatMap(WorkspaceDatabase, (workspace) =>
    workspace.db
      .insert(customerLocalePreferences)
      .values({ customerAccountId: accountId, locale })
      .onConflictDoNothing()
      .pipe(Effect.asVoid)
  );
