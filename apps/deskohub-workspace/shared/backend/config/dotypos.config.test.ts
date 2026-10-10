import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { DotyposService, ExternalAPIError } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { availabilityTags } from "@/shared/utils/cache-tags";

const revalidateTag = mock(
  (_tag: string, _profile: { readonly expire: number }) => undefined
);

mock.module("next/cache", () => ({ revalidateTag }));

const { ReservationWritesExpireAvailability } = await import(
  "./dotypos.config"
);

const failure = new ExternalAPIError({
  service: "dotypos",
  operation: "cancelReservation",
  message: "Synthetic timeout",
});
const getTables = mock(() => Effect.succeed([]));
const dotypos = Layer.succeed(DotyposService, {
  createReservation: () => Effect.succeed("created"),
  updateReservation: () => Effect.succeed("updated"),
  cancelReservation: () => Effect.fail(failure),
  confirmReservation: () => Effect.succeed("confirmed"),
  getTables,
} as never);

const runWithDotypos = <A, E>(
  use: (service: DotyposService["Service"]) => Effect.Effect<A, E>
) =>
  Effect.runPromise(
    Effect.result(
      Effect.flatMap(DotyposService, use).pipe(
        Effect.provide(
          ReservationWritesExpireAvailability.pipe(Layer.provide(dotypos))
        )
      )
    )
  );

beforeEach(() => {
  revalidateTag.mockReset();
  revalidateTag.mockImplementation(() => undefined);
});

describe("Dotypos reservation writes", () => {
  test("expire shared availability reservations after each occupancy write", async () => {
    await runWithDotypos((service) =>
      Effect.all([
        service.createReservation({} as never),
        service.updateReservation({} as never),
      ])
    );

    expect(revalidateTag.mock.calls).toEqual([
      [availabilityTags.reservations, { expire: 1 }],
      [availabilityTags.reservations, { expire: 1 }],
    ]);
  });

  test("expire the snapshot even when a write fails", async () => {
    const result = await runWithDotypos((service) =>
      service.cancelReservation({} as never)
    );

    expect(result._tag).toBe("Failure");
    expect(revalidateTag).toHaveBeenCalledTimes(1);
  });

  test("keep the write result when cache invalidation throws", async () => {
    revalidateTag.mockImplementation(() => {
      throw new Error("Route rendered outside a request");
    });

    const result = await runWithDotypos((service) =>
      service.createReservation({} as never)
    );

    expect(result).toMatchObject({ _tag: "Success", success: "created" });
  });

  test("leave reads and confirmations untouched", async () => {
    await runWithDotypos((service) =>
      Effect.all([service.getTables(), service.confirmReservation({} as never)])
    );

    expect(getTables).toHaveBeenCalledTimes(1);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
