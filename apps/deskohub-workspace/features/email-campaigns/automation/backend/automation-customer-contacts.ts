import "server-only";

import {
  type DotyposCustomerId,
  type DotyposCustomerLifecycle,
  DotyposService,
  dotyposFailureLogFields,
  getCustomerDisplayName,
} from "@deskohub/dotypos";
import { DateTime, Effect, Option } from "effect";
import { describeAdministrationCustomer } from "@/features/administration/customer-identity";

/** A customer's name, email and lifecycle as Dotypos has them now. */
export interface AutomationCustomerContact {
  readonly name: string | null;
  readonly email: string | null;
  /** Only the Admin UI reads it, to show a deleted or expired customer's placeholder. */
  readonly lifecycle: DotyposCustomerLifecycle;
}

/**
 * The current contacts of `customers`, read live from Dotypos one id batch
 * at a time and never stored. A customer Dotypos doesn't return is missing
 * from the map. A deleted or expired customer is never named: its name is the
 * administration placeholder and its email is null. Contacts are a
 * convenience for the admin views, so when Dotypos can't be read the result
 * is none instead of a failure.
 */
export const readAutomationCustomerContacts = Effect.fn(
  "readAutomationCustomerContacts"
)(function* (customers: Iterable<DotyposCustomerId>) {
  const dotypos = yield* DotyposService;
  return yield* dotypos
    .getCustomersByIds(customers, {
      concurrency: 1,
    })
    .pipe(
      Effect.flatMap((profiles) =>
        Effect.map(DateTime.nowAsDate, (now) =>
          Option.some(
            new Map(
              [...profiles].map(([id, profile]) => {
                const customer = describeAdministrationCustomer(profile, now);
                const contact: AutomationCustomerContact =
                  customer.lifecycle === "active"
                    ? {
                        name: getCustomerDisplayName(profile) ?? null,
                        email: customer.email,
                        lifecycle: customer.lifecycle,
                      }
                    : {
                        name: customer.displayName,
                        email: null,
                        lifecycle: customer.lifecycle,
                      };
                return [id, contact] as const;
              })
            ) as ReadonlyMap<DotyposCustomerId, AutomationCustomerContact>
          )
        )
      ),
      // Only the classification: Dotypos failures can carry customer values.
      Effect.catch((cause) =>
        Effect.logWarning(
          "Customer contacts couldn't be read",
          dotyposFailureLogFields(cause)
        ).pipe(
          Effect.as(
            Option.none<
              ReadonlyMap<DotyposCustomerId, AutomationCustomerContact>
            >()
          )
        )
      )
    );
});
