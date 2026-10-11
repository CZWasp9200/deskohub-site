import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import { Deferred, Effect, Fiber, Option, Queue } from "effect";
import {
  type AdvertisedPriceRequest,
  advertisedPriceRequestBatchSize,
} from "@/features/checkout/advertised-price";

mock.module("server-only", () => ({}));

let inFlightBuilds = 0;
let peakInFlightBuilds = 0;
let releaseGates: Queue.Queue<Deferred.Deferred<void>>;

mock.module(
  "@/features/checkout/backend/checkout/advertised-price.server",
  () => ({
    buildAdvertisedPrice: (request: AdvertisedPriceRequest) =>
      Effect.gen(function* () {
        const releaseGate = yield* Deferred.make<void>();
        inFlightBuilds += 1;
        peakInFlightBuilds = Math.max(peakInFlightBuilds, inFlightBuilds);
        yield* Queue.offer(releaseGates, releaseGate);
        yield* Deferred.await(releaseGate);
        inFlightBuilds -= 1;
        return { advertisedPriceToken: JSON.stringify(request) };
      }),
  })
);

const { loadAdvertisedPrices } = await import("./advertised-prices.server");

const requests: ReadonlyArray<AdvertisedPriceRequest> = Array.from(
  { length: advertisedPriceRequestBatchSize },
  (_, index) => ({
    locale: "en-US",
    reservation: {
      kind: "cowork",
      details: {
        kind: "cowork",
        entryTier: "basic",
        coffee: false,
        date: `2099-07-${String(index + 1).padStart(2, "0")}`,
      },
    },
  })
);

describe("loadAdvertisedPrices", () => {
  test("loads a full unique batch with at most six concurrent price builds", async () => {
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        releaseGates = yield* Queue.unbounded<Deferred.Deferred<void>>();
        const batch = yield* Effect.forkChild(loadAdvertisedPrices(requests));
        // Hold builds until six are in flight or no further build starts.
        const heldGates: Array<Deferred.Deferred<void>> = [];
        while (heldGates.length < 6) {
          const gate = yield* Queue.take(releaseGates).pipe(
            Effect.timeoutOption("1 second")
          );
          if (Option.isNone(gate)) break;
          heldGates.push(gate.value);
        }
        for (const gate of heldGates) {
          yield* Deferred.succeed(gate, undefined);
        }
        for (
          let remaining = requests.length - heldGates.length;
          remaining > 0;
          remaining -= 1
        ) {
          yield* Deferred.succeed(yield* Queue.take(releaseGates), undefined);
        }
        return { peak: peakInFlightBuilds, results: yield* Fiber.join(batch) };
      })
    );

    expect(outcome.peak).toBe(6);
    expect(outcome.results).toEqual(
      requests.map((request) => ({
        request,
        advertisedPrice: { advertisedPriceToken: JSON.stringify(request) },
      }))
    );
  });
});
