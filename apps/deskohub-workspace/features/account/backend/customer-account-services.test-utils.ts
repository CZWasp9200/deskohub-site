import { mock } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { withWorkspaceRequestContext } from "@/shared/backend/workspace-request-context";
import type { CustomerAccountId } from "../customer-account";

/** The header of the browser request `asBrowserRequest` runs under. */
const browserRequestHeader = "x-test-browser-request";

/**
 * Runs `effect` as a browser request, whose session
 * `CustomerAuthentication.Default` reads.
 */
export const asBrowserRequest = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    withWorkspaceRequestContext(
      new Headers({ [browserRequestHeader]: "browser" })
    )
  );

/**
 * Fakes what the account services' `ForProvidedAuthentication` Layers build
 * over, for tests of how a channel supplies their authentication. Call it
 * before importing any account service.
 *
 * Each account is linked to its customer in `links`, or unlinked, and is
 * active; none is a review account; the advisory lock records the account of
 * each lock it takes instead of reaching Postgres. Better Auth finds no
 * browser session and records each browser request it reads one for, so a
 * read of the browser session shows in `browserSessionReads`.
 */
export const fakeAccountServiceStores = async (
  links: ReadonlyMap<CustomerAccountId, DotyposCustomerId>
) => {
  const lockedAccounts: string[] = [];
  const browserSessionReads: string[] = [];

  const linksModule = await import("./customer-account-link.repository");
  class TestCustomerAccountLinkRepository extends linksModule.CustomerAccountLinkRepository {
    static override Live = Layer.mock(
      linksModule.CustomerAccountLinkRepository,
      {
        find: (accountId) => Effect.succeed(links.get(accountId) ?? null),
        findActivityState: () =>
          Effect.succeed({
            kind: "active",
            email: testEmailAddress("account-services"),
            deletionRequestedAt: null,
          }),
      }
    );
  }
  mock.module("./customer-account-link.repository", () => ({
    ...linksModule,
    CustomerAccountLinkRepository: TestCustomerAccountLinkRepository,
  }));

  const reviewAccountsModule = await import(
    "@/features/review-accounts/backend/review-accounts.repository"
  );
  class TestReviewAccounts extends reviewAccountsModule.ReviewAccounts {
    static override Live = Layer.mock(reviewAccountsModule.ReviewAccounts, {
      isReviewAccount: () => Effect.succeed(false),
    });
  }
  mock.module(
    "@/features/review-accounts/backend/review-accounts.repository",
    () => ({ ...reviewAccountsModule, ReviewAccounts: TestReviewAccounts })
  );

  const advisoryLockModule = await import("@/db/postgres-advisory-lock");
  const recordLock = <A, E, R>(
    key: readonly [string, string],
    effect: Effect.Effect<A, E, R>
  ) =>
    Effect.sync(() => lockedAccounts.push(key[1])).pipe(Effect.andThen(effect));
  class TestWorkspaceDatabaseAdvisoryLock extends advisoryLockModule.WorkspaceDatabaseAdvisoryLock {
    static override Default = Layer.succeed(
      advisoryLockModule.WorkspaceDatabaseAdvisoryLock,
      {
        withTransactionPermit: (effect) => effect,
        withLock: recordLock,
        withLocks: (keys, effect) =>
          Effect.forEach(keys, (key) => recordLock(key, Effect.void)).pipe(
            Effect.andThen(effect)
          ),
      }
    );
  }
  mock.module("@/db/postgres-advisory-lock", () => ({
    ...advisoryLockModule,
    WorkspaceDatabaseAdvisoryLock: TestWorkspaceDatabaseAdvisoryLock,
  }));

  mock.module("@/features/account/server/auth.server", () => ({
    auth: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          browserSessionReads.push(
            headers.get(browserRequestHeader) ?? "missing"
          );
          return null;
        },
      },
    },
  }));

  return { lockedAccounts, browserSessionReads };
};
