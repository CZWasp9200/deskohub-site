import { AresLookupService } from "@deskohub/ares";
import { Context, Effect, Layer, Match, Result } from "effect";
import {
  type AresBusinessBillingDraft,
  toAresBusinessBillingDraft,
} from "@/features/account/backend/ares-business-draft";
import type { CustomerAccountAccessError } from "@/features/account/customer-account";
import { CurrentCustomerAccount } from "./current-customer-account";

/**
 * What a company lookup found: the business billing fields the company
 * fills in, or why it found none. `invalid-ico` is an ID that fails the
 * IČO format or check digit, so the registry was never asked;
 * `unavailable` is a registry that didn't answer, which may be retried.
 */
export type CompanyLookupOutcome =
  | {
      readonly status: "found";
      readonly company: AresBusinessBillingDraft;
    }
  | { readonly status: "invalid-ico" }
  | { readonly status: "not-found" }
  | { readonly status: "unavailable" };

interface ICompanyLookupService {
  /**
   * Looks up the company with this ID, surrounding whitespace ignored. Fails
   * only when the session is gone, unverified, or awaiting deletion.
   */
  readonly lookup: (
    ico: string
  ) => Effect.Effect<CompanyLookupOutcome, CustomerAccountAccessError>;
}

/**
 * Looks up one Czech company in the public ARES registry for the signed-in
 * customer's business billing details. It runs behind the verified session
 * and the durable deletion marker, and makes exactly one registry request
 * per lookup, without retrying and without any provider write: it never
 * resolves the customer account, since resolution may reactivate and claim
 * an expired Dotypos profile and rejects an account whose link isn't
 * settled. The website's profile forms and the customer API both look up
 * through it.
 */
export class CompanyLookupService extends Context.Service<
  CompanyLookupService,
  ICompanyLookupService
>()("@deskohub-workspace/account/CompanyLookupService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const currentAccount = yield* CurrentCustomerAccount;
      const registry = yield* AresLookupService;

      const lookup = Effect.fn("CompanyLookupService.lookup")(function* (
        ico: string
      ) {
        yield* currentAccount.requireActive;

        const company = yield* Effect.result(registry.lookup(ico.trim()));
        if (Result.isSuccess(company)) {
          return {
            status: "found",
            company: toAresBusinessBillingDraft(company.success),
          } as const;
        }
        return Match.value(company.failure).pipe(
          Match.withReturnType<CompanyLookupOutcome>(),
          Match.discriminatorsExhaustive("reason")({
            InvalidIco: () => ({ status: "invalid-ico" }),
            NotFound: () => ({ status: "not-found" }),
            Unavailable: () => ({ status: "unavailable" }),
          })
        );
      });

      return { lookup };
    })
  );

  /** The lookup under the standing the caller provides. */
  static ForCurrentAccount = this.Default.pipe(
    Layer.provide(AresLookupService.Live)
  );

  /** The lookup under the browser session's standing. */
  static Live = this.ForCurrentAccount.pipe(
    Layer.provide(CurrentCustomerAccount.Live)
  );
}
