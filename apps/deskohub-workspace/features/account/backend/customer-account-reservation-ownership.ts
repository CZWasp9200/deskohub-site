import { Context, Effect, Layer } from "effect";
import type {
  CustomerAccountAccessError,
  CustomerAccountId,
  LinkedCustomerAccount,
} from "../customer-account";
import { CurrentCustomerAccount } from "./current-customer-account";
import { requireAccountActivity } from "./customer-account-activity";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import type { CustomerAccountSession } from "./customer-authentication.service";
import { requireLinkedCustomerAccount } from "./linked-customer-account";

interface ICustomerAccountReservationOwnership {
  /**
   * The signed-in account, verified active, without requiring a linked
   * Dotypos customer. It identifies the account that authored a reservation.
   */
  readonly activeAccountId: Effect.Effect<
    CustomerAccountId,
    CustomerAccountAccessError
  >;
  /**
   * The signed-in account's verified session, verified active like
   * `activeAccountId`. Its login email finds the reservations that invited
   * the account.
   */
  readonly activeAccount: Effect.Effect<
    CustomerAccountSession,
    CustomerAccountAccessError
  >;
  /**
   * The signed-in account with its linked Dotypos customer, verified active.
   * It identifies the customer a reservation was booked for.
   */
  readonly resolve: Effect.Effect<
    LinkedCustomerAccount,
    CustomerAccountAccessError
  >;
}

export class CustomerAccountReservationOwnership extends Context.Service<
  CustomerAccountReservationOwnership,
  ICustomerAccountReservationOwnership
>()("@deskohub-workspace/account/CustomerAccountReservationOwnership") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const current = yield* CurrentCustomerAccount;
      const links = yield* CustomerAccountLinkRepository;

      const activeAccount = current.requireActive.pipe(
        Effect.tap((session) =>
          requireAccountActivity(links, session.accountId)
        )
      );
      const activeAccountId = activeAccount.pipe(
        Effect.map((session) => session.accountId)
      );

      const resolve = requireLinkedCustomerAccount.pipe(
        Effect.provideService(CurrentCustomerAccount, current),
        Effect.tap((account) =>
          requireAccountActivity(links, account.accountId)
        )
      );

      return {
        activeAccountId,
        activeAccount,
        resolve,
      } satisfies ICustomerAccountReservationOwnership;
    })
  );

  /**
   * The service reading the customer through the `CustomerAuthentication`
   * the caller provides, over the same standing `CurrentCustomerAccount`
   * builds.
   */
  static ForProvidedAuthentication = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CurrentCustomerAccount.ForProvidedAuthentication,
        CustomerAccountLinkRepository.Live
      )
    )
  );
}
