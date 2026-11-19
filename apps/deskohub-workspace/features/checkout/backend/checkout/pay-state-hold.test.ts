import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { TestSealedStateKeys } from "@/shared/testing/sealed-state-keys.test-utils";
import { PayState } from "./pay-state";
import {
  getPayStateHoldExpiresAt,
  loadPayStateHoldExpiry,
  openPayStateWithHoldExpiry,
} from "./pay-state-hold";
import {
  sealSyntheticPayStateToken,
  syntheticHoldExpiresAt,
  syntheticPayStateOrderId,
} from "./signed-pay-state.test-utils";

const storedDeadline = Temporal.Instant.from("2099-07-01T10:09:30Z");

const storedReservation = (reservationHoldExpiresAt: Temporal.Instant | null) =>
  mock(() =>
    Effect.succeed({
      id: syntheticPayStateOrderId,
      reservationHoldExpiresAt,
    } as WorkspaceReservation)
  );

const withReservations = (
  findById: WorkspaceReservationRepository["Service"]["findById"]
) =>
  Effect.provide(
    Layer.mergeAll(
      TestSealedStateKeys,
      Layer.mock(WorkspaceReservationRepository, { findById })
    )
  );

const openToken = (token: string) =>
  Effect.runPromise(
    PayState.open(token).pipe(Effect.provide(TestSealedStateKeys))
  );

describe("getPayStateHoldExpiresAt", () => {
  test("keeps the signed deadline over the stored one", async () => {
    const state = await openToken(await sealSyntheticPayStateToken());

    expect(
      getPayStateHoldExpiresAt(state, {
        reservationHoldExpiresAt: storedDeadline,
      })
    ).toBe(syntheticHoldExpiresAt);
  });

  test("takes the stored deadline for a state signed without one", async () => {
    const state = await openToken(
      await sealSyntheticPayStateToken({ withoutHoldExpiry: true })
    );

    expect(state.holdExpiresAt).toBeUndefined();
    expect(
      getPayStateHoldExpiresAt(state, {
        reservationHoldExpiresAt: storedDeadline,
      })
    ).toBe("2099-07-01T10:09:30.000Z");
  });
});

describe("loadPayStateHoldExpiry", () => {
  test("reads no reservation when the state signs its deadline", async () => {
    const findById = storedReservation(storedDeadline);
    const token = await sealSyntheticPayStateToken();

    const held = await Effect.runPromise(
      PayState.open(token).pipe(
        Effect.flatMap(loadPayStateHoldExpiry),
        withReservations(findById)
      )
    );

    expect(held.holdExpiresAt).toBe(syntheticHoldExpiresAt);
    expect(findById).not.toHaveBeenCalled();
  });

  test("reads the stored deadline of a state signed without one", async () => {
    const findById = storedReservation(storedDeadline);
    const token = await sealSyntheticPayStateToken({ withoutHoldExpiry: true });

    const held = await Effect.runPromise(
      openPayStateWithHoldExpiry(token).pipe(withReservations(findById))
    );

    expect(findById).toHaveBeenCalledWith(syntheticPayStateOrderId);
    expect(held.holdExpiresAt).toBe("2099-07-01T10:09:30.000Z");
  });

  test("refuses a state whose reservation is gone or has no deadline", async () => {
    const token = await sealSyntheticPayStateToken({ withoutHoldExpiry: true });
    const load = (
      findById: WorkspaceReservationRepository["Service"]["findById"]
    ) =>
      Effect.runPromise(
        openPayStateWithHoldExpiry(token).pipe(
          Effect.flip,
          withReservations(findById)
        )
      );

    const missing = await load(mock(() => Effect.succeed(null)));
    const withoutDeadline = await load(storedReservation(null));

    expect(missing).toMatchObject({
      _tag: "CheckoutUnavailableError",
      reason: "missing_reservation",
    });
    expect(withoutDeadline).toMatchObject({
      _tag: "CheckoutUnavailableError",
      reason: "not_held",
    });
  });
});
