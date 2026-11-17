import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import {
  type DotyposCustomer,
  type DotyposCustomerId,
  type DotyposService,
  DotyposUnavailable,
  dotyposIdReadBatchSize,
} from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { makeInMemoryDotypos } from "@deskohub/dotypos/testing";
import { Effect, Layer, Logger, Option, Result } from "effect";
import { AdministrationCustomerDirectory } from "./customer-directory.service";
import {
  degradeProviderRead,
  failProviderRead,
  type ProviderReadPolicy,
} from "./provider-read-policy";

const customer = (
  id: string,
  fields: Partial<DotyposCustomer> = {}
): DotyposCustomer =>
  ({
    id,
    firstName: "Synthetic",
    lastName: id,
    deleted: false,
    ...fields,
  }) as DotyposCustomer;

const dotyposUnavailable = () =>
  Effect.fail(
    new DotyposUnavailable({ operation: "getCustomersByIds", reason: "server" })
  );

/** Runs one directory call over the given Dotypos and records every warning's arguments. */
const runDirectory = <A, E>(
  dotyposLayer: Layer.Layer<DotyposService>,
  operation: (
    directory: typeof AdministrationCustomerDirectory.Service
  ) => Effect.Effect<A, E>
) => {
  const warnings: unknown[][] = [];
  return Effect.gen(function* () {
    return yield* operation(yield* AdministrationCustomerDirectory);
  }).pipe(
    Effect.result,
    Effect.provide(
      AdministrationCustomerDirectory.Default.pipe(Layer.provide(dotyposLayer))
    ),
    Effect.provide(
      Logger.layer([
        Logger.make(({ logLevel, message }) => {
          if (logLevel === "Warn") warnings.push([message].flat());
        }),
      ])
    ),
    Effect.runPromise,
    (result) => result.then((value) => ({ result: value, warnings }))
  );
};

const ids = (customers: readonly DotyposCustomer[]) =>
  customers.map(({ id }) => id);

describe("AdministrationCustomerDirectory.search", () => {
  const searchOver = (matches: readonly DotyposCustomer[]) =>
    runDirectory(
      DotyposServiceMock({
        searchCustomers: () => Effect.succeed([...matches]),
      }),
      (d) => d.search("synthetic")
    ).then(({ result }) => Result.getOrThrow(result));

  test("hides deleted and expired customers and keeps the Dotypos order", async () => {
    const search = await searchOver([
      customer("customer-b"),
      customer("customer-deleted", { deleted: true }),
      customer("customer-expired", { expireDate: "2020-01-01T00:00:00Z" }),
      customer("customer-expiring", { expireDate: "2999-01-01T00:00:00Z" }),
      customer("customer-a"),
    ]);

    expect(ids(search.customers)).toEqual([
      "customer-b",
      "customer-expiring",
      "customer-a",
    ]);
    expect(search.kind).toBe("ambiguous");
  });

  test("caps the customers left after filtering at 50, in Dotypos order", async () => {
    const matches = Array.from({ length: 60 }, (_, index) =>
      customer(`customer-${index}`, { deleted: index < 5 })
    );

    const search = await searchOver(matches);

    expect(ids(search.customers)).toEqual(
      Array.from({ length: 50 }, (_, index) => `customer-${index + 5}`)
    );
  });

  test("classifies the customers it returns", async () => {
    expect(
      (
        await searchOver([
          customer("customer-deleted", { deleted: true }),
          customer("customer-expired", { expireDate: "2020-01-01T00:00:00Z" }),
          customer("customer-only"),
        ])
      ).kind
    ).toBe("matched");
    expect(
      (await searchOver([customer("customer-deleted", { deleted: true })])).kind
    ).toBe("not-found");
    expect((await searchOver([])).kind).toBe("not-found");
  });

  test("passes a Dotypos failure through", async () => {
    const { result } = await runDirectory(
      DotyposServiceMock({ searchCustomers: dotyposUnavailable }),
      (d) => d.search("synthetic")
    );

    expect(Result.isFailure(result) && result.failure).toBeInstanceOf(
      DotyposUnavailable
    );
  });
});

describe("AdministrationCustomerDirectory.find", () => {
  const dotypos = makeInMemoryDotypos({
    customers: [
      customer("customer-active"),
      customer("customer-deleted", { deleted: true }),
      customer("customer-expired", { expireDate: "2020-01-01T00:00:00Z" }),
      customer("customer-expiring", { expireDate: "2999-01-01T00:00:00Z" }),
    ],
  });

  const find = (id: string) =>
    runDirectory(dotypos.layer, (d) => d.find(id as DotyposCustomerId)).then(
      ({ result }) => Result.getOrThrow(result)
    );

  test("finds an active customer, including one whose expiry is still ahead", async () => {
    expect(Option.map(await find("customer-active"), ({ id }) => id)).toEqual(
      Option.some("customer-active")
    );
    expect(Option.map(await find("customer-expiring"), ({ id }) => id)).toEqual(
      Option.some("customer-expiring")
    );
  });

  test("treats a deleted or expired customer as missing", async () => {
    expect(Option.isNone(await find("customer-deleted"))).toBe(true);
    expect(Option.isNone(await find("customer-expired"))).toBe(true);
    expect(Option.isNone(await find("customer-missing"))).toBe(true);
  });
});

describe("AdministrationCustomerDirectory.findMany", () => {
  const stored = [
    customer("customer-1"),
    customer("customer-2", { deleted: true }),
    customer("customer-3"),
  ];
  const requested = ["customer-1", "customer-2", "customer-3"].map(
    (id) => id as DotyposCustomerId
  );

  /**
   * Dotypos holding `stored`, whose batch answers only for `batchIds` (or
   * fails), and whose single reads are recorded.
   */
  const findMany = <E>(
    policy: ProviderReadPolicy<E>,
    {
      batch,
      single,
    }: {
      readonly batch: "fails" | readonly string[];
      readonly single?: "fails";
    }
  ) => {
    const singleReads: string[] = [];
    const { service } = makeInMemoryDotypos({ customers: stored });
    return runDirectory(
      DotyposServiceMock({
        getCustomersByIds: (batchIds, options) =>
          batch === "fails"
            ? dotyposUnavailable()
            : service.getCustomersByIds(
                [...batchIds].filter((id) => batch.includes(id)),
                options
              ),
        getCustomer: (id) =>
          Effect.suspend(() => {
            singleReads.push(id);
            return single === "fails"
              ? dotyposUnavailable()
              : service.getCustomer(id);
          }),
      }),
      (d) => d.findMany(requested, policy)
    ).then(({ result, warnings }) => ({ result, singleReads, warnings }));
  };

  const foundIds = (
    result: Result.Result<
      ReadonlyMap<DotyposCustomerId, DotyposCustomer>,
      unknown
    >
  ) => [...Result.getOrThrow(result).keys()].sort();

  for (const [name, policy] of [
    ["a page", degradeProviderRead],
    ["an export", failProviderRead],
  ] as const) {
    test(`for ${name}, reads the customers a batch left out on their own, deleted ones included`, async () => {
      const { result, singleReads } = await findMany(policy, {
        batch: ["customer-1"],
      });

      expect(singleReads.sort()).toEqual(["customer-2", "customer-3"]);
      expect(foundIds(result)).toEqual([
        "customer-1",
        "customer-2",
        "customer-3",
      ]);
    });
  }

  test("leaves a customer Dotypos doesn't have absent, without a warning", async () => {
    const { result, warnings } = await runDirectory(
      makeInMemoryDotypos({ customers: [customer("customer-1")] }).layer,
      (d) =>
        d.findMany(
          ["customer-1", "customer-missing"] as DotyposCustomerId[],
          failProviderRead
        )
    );

    expect(foundIds(result)).toEqual(["customer-1"]);
    expect(warnings).toEqual([]);
  });

  test("for a page, falls back to single reads when a batch fails, and logs it", async () => {
    const { result, singleReads, warnings } = await findMany(
      degradeProviderRead,
      { batch: "fails" }
    );

    expect(singleReads.sort()).toEqual(requested);
    expect(foundIds(result)).toEqual(requested);
    expect(warnings).toHaveLength(1);
  });

  test("for a page, keeps the batches that succeeded and reads only a failed batch's customers on their own", async () => {
    const many = Array.from(
      { length: dotyposIdReadBatchSize + 1 },
      (_, index) => customer(`customer-${String(index).padStart(3, "0")}`)
    );
    const failedBatchId = many[0]?.id;
    const singleReads: string[] = [];
    const { service } = makeInMemoryDotypos(
      { customers: many },
      {
        onRequest: ({ ids }) =>
          failedBatchId && ids?.includes(failedBatchId)
            ? dotyposUnavailable()
            : Effect.void,
      }
    );

    const { result } = await runDirectory(
      DotyposServiceMock({
        getCustomersByIds: service.getCustomersByIds,
        getCustomer: (id) =>
          Effect.suspend(() => {
            singleReads.push(id);
            return Effect.succeed(
              Option.fromNullishOr(many.find((stored) => stored.id === id))
            );
          }),
      }),
      (d) => d.findMany(ids(many), degradeProviderRead)
    );

    expect(Result.getOrThrow(result).size).toBe(many.length);
    expect(singleReads).toHaveLength(dotyposIdReadBatchSize);
  });

  test("for a page, leaves a customer whose single read fails absent, and logs its id", async () => {
    const { result, warnings } = await findMany(degradeProviderRead, {
      batch: ["customer-1"],
      single: "fails",
    });

    expect(foundIds(result)).toEqual(["customer-1"]);
    expect(warnings.map((args) => args.at(-1))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ customerId: "customer-2" }),
        expect.objectContaining({ customerId: "customer-3" }),
      ])
    );
  });

  for (const { name, dotypos } of [
    { name: "a batch fails", dotypos: { batch: "fails" } },
    {
      name: "a single read of a left-out customer fails",
      dotypos: { batch: ["customer-1"], single: "fails" },
    },
  ] as const) {
    test(`for an export, fails when ${name}`, async () => {
      const { result, singleReads } = await findMany(failProviderRead, dotypos);

      expect(Result.isFailure(result) && result.failure).toMatchObject({
        _tag: "AdministrationListSourceUnavailableError",
        source: "customer-details",
      });
      if (dotypos.batch === "fails") expect(singleReads).toEqual([]);
    });
  }
});
