import {
  customerLifecycle,
  type DotyposCustomer,
  type DotyposCustomerId,
  type DotyposReadFailure,
  DotyposService,
} from "@deskohub/dotypos";
import { Context, DateTime, Effect, Layer, Option } from "effect";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import {
  degradeProviderRead,
  type ProviderReadPolicy,
  recoverProviderRead,
} from "./provider-read-policy";

/** The most customers a search returns. */
const searchLimit = 50;

/** A search's customers that are neither deleted nor expired, in Dotypos order, at most 50. */
export type AdministrationCustomerSearch = {
  /** Classified on the returned customers: one is `matched`, more are `ambiguous`. */
  readonly kind: "matched" | "not-found" | "ambiguous";
  readonly customers: readonly DotyposCustomer[];
};

interface IAdministrationCustomerDirectory {
  /** The query is the decoded `AdministrationCustomerSearchQuery["query"]`. */
  readonly search: (
    query: string
  ) => Effect.Effect<AdministrationCustomerSearch, DotyposReadFailure>;
  /** None when Dotypos has no such customer, or it is deleted or expired. */
  readonly find: (
    id: DotyposCustomerId
  ) => Effect.Effect<Option.Option<DotyposCustomer>, DotyposReadFailure>;
  /**
   * Every customer Dotypos returns, deleted and expired ones included, for
   * `describeAdministrationCustomer` to show as placeholders. An id a batch left
   * out is read on its own; a missing customer is absent from the map. A
   * failed read follows `policy`: a page degrades (logs, leaves it absent);
   * an export fails with `AdministrationListSourceUnavailableError`.
   */
  readonly findMany: <E = never>(
    ids: Iterable<DotyposCustomerId>,
    policy?: ProviderReadPolicy<E>
  ) => Effect.Effect<ReadonlyMap<DotyposCustomerId, DotyposCustomer>, E>;
}

/**
 * The administrator's read of Dotypos customers: which customers a search or
 * lookup shows, and how a list read survives a failing Dotypos.
 */
export class AdministrationCustomerDirectory extends Context.Service<
  AdministrationCustomerDirectory,
  IAdministrationCustomerDirectory
>()("@deskohub-workspace/administration/AdministrationCustomerDirectory") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const dotypos = yield* DotyposService;
      /** Whether an administrator may find the customer: neither deleted nor expired when read. */
      const isFindable = (customer: DotyposCustomer, now: Date) =>
        customerLifecycle(customer, now) === "active";

      const search = Effect.fn("AdministrationCustomerDirectory.search")(
        function* (query: string) {
          const found = yield* dotypos.searchCustomers(query);
          const now = yield* DateTime.nowAsDate;
          const customers = found
            .filter((customer) => isFindable(customer, now))
            .slice(0, searchLimit);
          let kind: AdministrationCustomerSearch["kind"] = "not-found";
          if (customers.length === 1) kind = "matched";
          else if (customers.length > 1) kind = "ambiguous";
          return { kind, customers } satisfies AdministrationCustomerSearch;
        }
      );

      const find = Effect.fn("AdministrationCustomerDirectory.find")(function* (
        id: DotyposCustomerId
      ) {
        const customer = yield* dotypos.getCustomer(id);
        const now = yield* DateTime.nowAsDate;
        return Option.filter(customer, (found) => isFindable(found, now));
      });

      const findMany = Effect.fn("AdministrationCustomerDirectory.findMany")(
        function* <E = never>(
          ids: Iterable<DotyposCustomerId>,
          policy: ProviderReadPolicy<E> = degradeProviderRead
        ) {
          const uniqueIds = [...new Set(ids)];
          yield* Effect.annotateCurrentSpan({
            uniqueCustomerCount: uniqueIds.length,
          });
          const customersById = new Map(
            yield* dotypos
              .getCustomersByIds(uniqueIds, {
                concurrency: 3,
                ...(policy.kind === "degrade" && {
                  onBatchFailure: (cause) =>
                    degradeProviderRead.recover(
                      {
                        cause,
                        message: "Batch customer details unavailable",
                        source: "customer-details",
                      },
                      undefined
                    ),
                }),
              })
              .pipe(
                Effect.catch(
                  recoverProviderRead(
                    policy,
                    {
                      message: "Batch customer details unavailable",
                      source: "customer-details",
                    },
                    new Map<DotyposCustomerId, DotyposCustomer>()
                  )
                )
              )
          );
          // Missing batch records, including degraded batches, retain the individual lookup fallback.
          const unreturnedIds = uniqueIds.filter(
            (id) => !customersById.has(id)
          );
          const missingCustomers = yield* Effect.all(
            unreturnedIds.map((id) =>
              dotypos.getCustomer(id).pipe(
                Effect.map(
                  Option.match({
                    onNone: () => null,
                    onSome: (customer) => [id, customer] as const,
                  })
                ),
                Effect.catch(
                  recoverProviderRead(
                    policy,
                    {
                      annotations: { customerId: id },
                      message: "Customer details unavailable",
                      source: "customer-details",
                    },
                    null
                  )
                )
              )
            ),
            { concurrency: 5 }
          );
          for (const customer of missingCustomers) {
            if (customer) customersById.set(...customer);
          }
          return customersById;
        }
      );

      return {
        search,
        find,
        findMany,
      } satisfies IAdministrationCustomerDirectory;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDotyposLayer));
}
