import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import {
  testCustomerSession,
  testLinkedAccount,
} from "./account-operations.test-utils";
import {
  asBrowserRequest,
  fakeAccountServiceStores,
} from "./customer-account-services.test-utils";

// The supplied session's account is linked, so its standing and contact name
// it; Dotypos is faked.
const stores = await fakeAccountServiceStores(
  new Map([[testLinkedAccount.accountId, testLinkedAccount.dotyposCustomerId]])
);

const { CurrentCustomerAccount } = await import("./current-customer-account");
const { CustomerAccountContactService } = await import(
  "./customer-account-contact.service"
);
const { CustomerAccountReservationOwnership } = await import(
  "./customer-account-reservation-ownership"
);
const { CustomerAccountSections } = await import("./customer-account-sections");
const { CustomerAccountServices } = await import("./customer-account-services");
const { CustomerAuthentication } = await import(
  "./customer-authentication.service"
);
const { CustomerProfileService } = await import("./customer-profile.service");

/**
 * An authentication the caller supplies, reading `testCustomerSession`, that
 * counts how often it is built and how often a service reads the session
 * through it.
 */
const suppliedAuthentication = () => {
  const counts = { constructions: 0, sessionReads: 0 };
  const layer = Layer.effect(
    CustomerAuthentication,
    Effect.sync(() => {
      counts.constructions += 1;
      return CustomerAuthentication.of({
        currentUser: Effect.sync(() => {
          counts.sessionReads += 1;
          return testCustomerSession;
        }),
      });
    })
  );
  return { counts, layer };
};

/** `effect`'s value and how many session reads it made through `counts`. */
const countingReads =
  (counts: { readonly sessionReads: number }) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.suspend(() => {
      const before = counts.sessionReads;
      return Effect.map(effect, (value) => ({
        value,
        sessionReads: counts.sessionReads - before,
      }));
    });

const optionalAccount = CustomerAccountSections.pipe(
  Effect.flatMap((sections) =>
    sections.withOptionalAccount((accountId) => Effect.succeed(accountId))
  )
);
const peekedStanding = CurrentCustomerAccount.pipe(
  Effect.flatMap((current) => current.peek)
);
const bookingContact = CustomerAccountContactService.pipe(
  Effect.flatMap((contact) => contact.current),
  Effect.map((contact) => contact?.accountId ?? null)
);

describe("CustomerAccountServices", () => {
  test("builds every account service over the one authentication the caller supplies", async () => {
    stores.lockedAccounts.length = 0;
    stores.browserSessionReads.length = 0;
    const { counts, layer } = suppliedAuthentication();
    const reading = countingReads(counts);

    const result = await Effect.all({
      sections: reading(optionalAccount),
      standing: reading(peekedStanding),
      contact: reading(bookingContact),
      author: reading(
        CustomerAccountReservationOwnership.pipe(
          Effect.flatMap((ownership) => ownership.activeAccountId)
        )
      ),
      // The profile service reads no session: its sections run the `active`
      // recheck for the account they are given.
      profile: Effect.map(CustomerProfileService, () => "provided"),
    }).pipe(
      Effect.provide(CustomerAccountServices.pipe(Layer.provide(layer))),
      asBrowserRequest,
      Effect.runPromise
    );

    expect(result).toMatchObject({
      sections: { value: testCustomerSession.accountId, sessionReads: 1 },
      standing: {
        value: {
          kind: "linked",
          session: { accountId: testCustomerSession.accountId },
          account: testLinkedAccount,
        },
      },
      contact: { value: testCustomerSession.accountId },
      author: { value: testCustomerSession.accountId },
      profile: "provided",
    });
    expect(result.standing.sessionReads).toBeGreaterThan(0);
    expect(result.contact.sessionReads).toBeGreaterThan(0);
    expect(result.author.sessionReads).toBeGreaterThan(0);
    expect(counts.constructions).toBe(1);
    expect(stores.lockedAccounts).toEqual([testCustomerSession.accountId]);
    // A browser request was being served, yet no service read its session.
    expect(stores.browserSessionReads).toEqual([]);
  });
});

/** The browser requests whose session `effect` read. */
const browserSessionReadsOf = async (
  effect: Effect.Effect<unknown, unknown>
) => {
  stores.browserSessionReads.length = 0;
  await effect.pipe(asBrowserRequest, Effect.runPromise);
  return [...stores.browserSessionReads];
};

describe("the site's Live account services", () => {
  test("read the browser session", async () => {
    expect(
      await browserSessionReadsOf(
        Effect.provide(optionalAccount, CustomerAccountSections.Live)
      )
    ).toEqual(["browser"]);
    expect(
      await browserSessionReadsOf(
        Effect.provide(peekedStanding, CurrentCustomerAccount.Live)
      )
    ).toContain("browser");
    expect(
      await browserSessionReadsOf(
        Effect.provide(bookingContact, CustomerAccountContactService.Live)
      )
    ).toContain("browser");
  });
});
