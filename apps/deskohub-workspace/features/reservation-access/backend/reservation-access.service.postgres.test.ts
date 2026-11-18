import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, mock, test } from "bun:test";
import {
  AlgoPinSchema,
  IgloohomeDeviceIdSchema,
  IgloohomePinIdSchema,
  IgloohomeRequestError,
  IgloohomeService,
} from "@deskohub/igloohome";
import { NodeCrypto } from "@effect/platform-node";
import { Deferred, Effect, Fiber, Layer, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import { WorkspaceDatabase } from "@/db/database.service";
import { reservationAccessGrants } from "@/db/schema";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { ReservationAccessGrantState } from "../reservation-access";
import { getIgloohomeAccessWindow } from "./igloohome-access-window";
import { ReservationAccessRepository } from "./reservation-access.repository";
import { ReservationAccessService } from "./reservation-access.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

// 08:00–17:00 in Prague, opened again after it started.
const reservation = {
  reservedFrom: Temporal.Instant.from("2030-03-04T07:00:00Z"),
  reservedUntil: Temporal.Instant.from("2030-03-04T16:00:00Z"),
};
const beforeHour = Temporal.Instant.from("2030-03-04T09:59:59Z");
const afterHour = Temporal.Instant.from("2030-03-04T10:00:00Z");

const issuedPin = AlgoPinSchema.make("246813579");

interface ClaimGate {
  readonly reached: Deferred.Deferred<void>;
  readonly release: Deferred.Deferred<void>;
}

describe.skipIf(!testDatabase)(
  "ReservationAccessService on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const reservationIds: WorkspaceReservationId[] = [];

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from reservation_access_grants where workspace_reservation_id = any($1)",
        [reservationIds]
      );
      await testDatabase.pool.query(
        "delete from workspace_reservations where id = any($1)",
        [reservationIds]
      );
    });

    const insertReservation = async () => {
      const { id } = await Effect.runPromise(
        workspaceFixtures(testDatabase.db).reservation({
          stage: { reservation: "confirmed" },
        })
      );
      reservationIds.push(id);
      return id;
    };

    test.each([
      { first: beforeHour, second: afterHour },
      { first: afterHour, second: beforeHour },
    ])(
      "keeps exact bounds and one issuance when requests at $first and $second straddle an hour",
      async ({ first, second }) => {
        const reservationId = await insertReservation();
        const requestedHours: { startsAt: string; endsAt: string }[] = [];
        const gates: ClaimGate[] = [];

        // Each claim waits for the test, so both requests store their
        // target before either claims it.
        const gatedRepository = Layer.effect(
          ReservationAccessRepository,
          Effect.gen(function* () {
            const repository = yield* ReservationAccessRepository;
            let claims = 0;
            return ReservationAccessRepository.of({
              ...repository,
              claim: (input) =>
                Effect.gen(function* () {
                  const gate = gates[claims++];
                  if (gate) {
                    yield* Deferred.succeed(gate.reached, undefined);
                    yield* Deferred.await(gate.release);
                  }
                  return yield* repository.claim(input);
                }),
            });
          })
        ).pipe(Layer.provide(ReservationAccessRepository.Default));
        const igloohome = Layer.mock(IgloohomeService, {
          issueHourlyAlgoPin: ({ startsAt, endsAt }) =>
            Effect.sync(() => {
              requestedHours.push({ startsAt, endsAt });
              return {
                pin: issuedPin,
                pinId: IgloohomePinIdSchema.make("synthetic-straddle-pin"),
              };
            }),
        });

        await Effect.gen(function* () {
          const service = yield* ReservationAccessService;
          const issueAt = (now: Temporal.Instant) =>
            TestClock.setTime(now.epochMilliseconds).pipe(
              Effect.andThen(
                service.issueForReservation({ reservationId, ...reservation })
              ),
              Effect.provide(TestClock.layer()),
              Effect.result
            );
          // Fails at once rather than at the test timeout when a request
          // ends before it claims.
          const awaitClaim = <A>(gate: ClaimGate, request: Fiber.Fiber<A>) =>
            Effect.raceFirst(
              Deferred.await(gate.reached),
              Fiber.await(request).pipe(
                Effect.andThen(Effect.die("Request ended before claiming."))
              )
            );
          const gateFor = Effect.gen(function* () {
            const gate = {
              reached: yield* Deferred.make<void>(),
              release: yield* Deferred.make<void>(),
            };
            gates.push(gate);
            return gate;
          });

          const firstGate = yield* gateFor;
          const secondGate = yield* gateFor;
          const firstRequest = yield* Effect.forkChild(issueAt(first));
          yield* awaitClaim(firstGate, firstRequest);
          const secondRequest = yield* Effect.forkChild(issueAt(second));
          yield* awaitClaim(secondGate, secondRequest);

          yield* Deferred.succeed(firstGate.release, undefined);
          const firstResult = yield* Fiber.join(firstRequest);
          yield* Deferred.succeed(secondGate.release, undefined);
          const secondResult = yield* Fiber.join(secondRequest);

          const grant = yield* service.loadGrant(reservationId);
          expect(grant?.state).toBe("issued");
          if (!grant) return;
          expect(requestedHours).toHaveLength(1);
          const [requested] = requestedHours;
          if (!requested) return;
          expect(
            grant.scheduledAccessStartsAt.equals(reservation.reservedFrom)
          ).toBe(true);
          expect(grant.accessStartsAt.equals(reservation.reservedFrom)).toBe(
            true
          );
          expect(grant.accessEndsAt.equals(reservation.reservedUntil)).toBe(
            true
          );
          // The first claimant owns issuance; provider hours are adapter data,
          // independent of the exact reservation bounds both requests share.
          expect(requested).toEqual(
            Option.getOrNull(
              getIgloohomeAccessWindow({
                startsAt: reservation.reservedFrom,
                endsAt: reservation.reservedUntil,
                now: first,
              })
            )
          );

          const results = [firstResult, secondResult];
          const issued = results.filter(Result.isSuccess);
          expect(issued).toHaveLength(1);
          expect(
            issued[0]?.success.accessStartsAt.equals(grant.accessStartsAt)
          ).toBe(true);
          const [lost] = results.filter(Result.isFailure);
          expect(lost?.failure.outcome).toBe("uncertain");

          // The losing request's retry discloses the exact stored bounds and PIN
          // without programming the lock again.
          const retried = yield* issueAt(afterHour.add({ seconds: 5 }));
          expect(Result.isSuccess(retried)).toBe(true);
          if (Result.isSuccess(retried)) {
            expect(
              retried.success.accessStartsAt.equals(grant.accessStartsAt)
            ).toBe(true);
            expect(retried.success.accessCode === issuedPin).toBe(true);
          }
          expect(requestedHours).toHaveLength(1);
        }).pipe(
          Effect.provide(
            ReservationAccessService.Default.pipe(
              Layer.provide(Layer.mergeAll(gatedRepository, igloohome)),
              Layer.provide(NodeCrypto.layer),
              Layer.provide(testDatabase.layer)
            )
          ),
          Effect.runPromise
        );
      }
    );

    describe("restoring a cancelled reservation", () => {
      const upcoming = {
        reservedFrom: Temporal.Instant.from("2099-07-01T08:00:00Z"),
        reservedUntil: Temporal.Instant.from("2099-07-01T16:00:00Z"),
      };
      const restoredAt = Temporal.Instant.from("2099-06-01T10:00:00Z");
      const restoredPin = AlgoPinSchema.make("135792468");

      const insertGrant = async (
        reservationId: WorkspaceReservationId,
        state: ReservationAccessGrantState
      ) => {
        const [grant] = await Effect.runPromise(
          testDatabase.db
            .insert(reservationAccessGrants)
            .values({
              workspaceReservationId: reservationId,
              deviceId: IgloohomeDeviceIdSchema.make("fixture-ek1"),
              state,
              accessName: "Deskohub synthetic-cancelled-grant",
              scheduledAccessStartsAt: upcoming.reservedFrom,
              accessStartsAt: upcoming.reservedFrom,
              accessEndsAt: upcoming.reservedUntil,
              providerCredentialId: IgloohomePinIdSchema.make(
                "synthetic-removed-pin"
              ),
              issuedAt: Temporal.Instant.from("2099-05-01T10:00:00Z"),
              ...(state === "provisioning" && {
                provisioningStartedAt: Temporal.Now.instant(),
              }),
              ...(state === "issued" && {
                accessCode: AlgoPinSchema.make("975318642"),
              }),
              ...((state === "failed" || state === "uncertain") && {
                failedAt: Temporal.Instant.from("2099-05-01T10:00:00Z"),
                failureCode: "provider_request_rejected",
              }),
            })
            .returning()
        );
        if (!grant) throw new Error("Synthetic grant was not inserted.");
        return grant;
      };

      const igloohomeIssuing = (
        issued: Effect.Effect<
          {
            pin: typeof restoredPin;
            pinId: ReturnType<typeof IgloohomePinIdSchema.make>;
          },
          IgloohomeRequestError
        >
      ) => {
        const issueHourlyAlgoPin = mock(() => issued);
        return {
          issueHourlyAlgoPin,
          layer: Layer.mock(IgloohomeService, { issueHourlyAlgoPin }),
        };
      };

      const run = <A, E>(
        program: (
          service: typeof ReservationAccessService.Service
        ) => Effect.Effect<A, E, WorkspaceDatabase>,
        igloohome = igloohomeIssuing(
          Effect.die("Igloohome must not be called")
        ).layer
      ) =>
        Effect.gen(function* () {
          return yield* program(yield* ReservationAccessService);
        }).pipe(
          Effect.provide(
            ReservationAccessService.Default.pipe(
              Layer.provide(
                Layer.mergeAll(ReservationAccessRepository.Default, igloohome)
              ),
              Layer.provide(NodeCrypto.layer),
              Layer.provideMerge(testDatabase.layer)
            )
          ),
          Effect.runPromise
        );

      /** Prepares restored access in its own committed transaction. */
      const prepare = (
        reservationId: WorkspaceReservationId,
        reservedUntil = upcoming.reservedUntil
      ) =>
        run((service) =>
          Effect.flatMap(WorkspaceDatabase, ({ transaction }) =>
            transaction(
              service.prepareRestoredAccess({
                reservationId,
                reservedFrom: upcoming.reservedFrom,
                reservedUntil,
                now: restoredAt,
              })
            )
          )
        );

      const loadGrant = (reservationId: WorkspaceReservationId) =>
        run((service) => service.loadGrant(reservationId));

      test("reopens an expired grant and issues fresh access through normal issuance", async () => {
        const reservationId = await insertReservation();
        const expired = await insertGrant(reservationId, "expired");

        expect(await prepare(reservationId)).toBe("issue");
        const reopened = await loadGrant(reservationId);
        expect(reopened).toMatchObject({
          id: expired.id,
          state: "pending",
          providerCredentialId: null,
          issuedAt: null,
          accessName: expired.accessName,
        });

        const igloohome = igloohomeIssuing(
          Effect.succeed({
            pin: restoredPin,
            pinId: IgloohomePinIdSchema.make("synthetic-restored-pin"),
          })
        );
        expect(
          await run(
            (service) =>
              service.issueRestoredAccess({ reservationId, ...upcoming }),
            igloohome.layer
          )
        ).toBe("issued");
        expect(igloohome.issueHourlyAlgoPin).toHaveBeenCalledTimes(1);
        expect(await loadGrant(reservationId)).toMatchObject({
          id: expired.id,
          state: "issued",
          providerCredentialId: "synthetic-restored-pin",
        });
      });

      test("rolls the reopened grant back with the restoring transaction", async () => {
        const reservationId = await insertReservation();
        await insertGrant(reservationId, "expired");

        const rolledBack = await run((service) =>
          Effect.flatMap(WorkspaceDatabase, ({ transaction }) =>
            transaction(
              service
                .prepareRestoredAccess({
                  reservationId,
                  ...upcoming,
                  now: restoredAt,
                })
                .pipe(Effect.andThen(Effect.fail("restore refused" as const)))
            )
          ).pipe(Effect.result)
        );

        expect(Result.isFailure(rolledBack)).toBe(true);
        expect((await loadGrant(reservationId))?.state).toBe("expired");
      });

      test("leaves the expired grant of an ended reservation as it is", async () => {
        const reservationId = await insertReservation();
        const expired = await insertGrant(reservationId, "expired");

        expect(
          await prepare(reservationId, restoredAt.subtract({ hours: 1 }))
        ).toBe("not_needed");
        expect(await loadGrant(reservationId)).toMatchObject({
          state: "expired",
          updatedAt: expired.updatedAt,
        });
      });

      test.each([
        "issued",
        "provisioning",
        "uncertain",
        "pending",
        "failed",
      ] as const)("refuses a %s grant without changing it", async (state) => {
        const reservationId = await insertReservation();
        const grant = await insertGrant(reservationId, state);

        expect(await prepare(reservationId)).toBe("uncertain");
        expect(await loadGrant(reservationId)).toMatchObject({
          state,
          updatedAt: grant.updatedAt,
        });
      });

      test("creates a pending grant for a reservation without one", async () => {
        const reservationId = await insertReservation();

        expect(await prepare(reservationId)).toBe("issue");
        expect(await loadGrant(reservationId)).toMatchObject({
          state: "pending",
          deviceId: "fixture-ek1",
          providerCredentialId: null,
        });
        const created = await loadGrant(reservationId);
        expect(created?.accessName).toBe(`Deskohub ${created?.id}`);
        expect(created?.accessStartsAt.equals(upcoming.reservedFrom)).toBe(
          true
        );
        expect(created?.accessEndsAt.equals(upcoming.reservedUntil)).toBe(true);
      });

      test("leaves a reservation that has ended without a grant", async () => {
        const reservationId = await insertReservation();

        expect(
          await prepare(reservationId, restoredAt.subtract({ hours: 1 }))
        ).toBe("not_needed");
        expect(await loadGrant(reservationId)).toBeNull();
      });

      test.each([
        { outcome: "rejected", state: "failed" },
        { outcome: "ambiguous", state: "uncertain" },
      ] as const)(
        "reports a $outcome reissue as failed and leaves a $state grant for the administration retry",
        async ({ outcome, state }) => {
          const reservationId = await insertReservation();
          await insertGrant(reservationId, "expired");
          expect(await prepare(reservationId)).toBe("issue");

          const failing = igloohomeIssuing(
            Effect.fail(
              new IgloohomeRequestError({
                operation: "issue_hourly_algopin",
                outcome,
                message: "synthetic provider failure",
              })
            )
          );
          expect(
            await run(
              (service) =>
                service.issueRestoredAccess({ reservationId, ...upcoming }),
              failing.layer
            )
          ).toBe("failed");
          expect((await loadGrant(reservationId))?.state).toBe(state);
        }
      );

      test("stops a restored issuance in flight once an administrator claims the reservation's cancellation", async () => {
        const reservationId = await insertReservation();
        await insertGrant(reservationId, "expired");
        expect(await prepare(reservationId)).toBe("issue");
        const igloohome = igloohomeIssuing(
          Effect.die("Igloohome must not be called")
        );

        await Effect.gen(function* () {
          const reached = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          // Issuance has read and prepared the grant when it reaches its
          // claim; the cancellation is claimed before the claim runs.
          const gatedRepository = Layer.effect(
            ReservationAccessRepository,
            Effect.map(ReservationAccessRepository, (repository) =>
              ReservationAccessRepository.of({
                ...repository,
                claim: (input) =>
                  Deferred.succeed(reached, undefined).pipe(
                    Effect.andThen(Deferred.await(release)),
                    Effect.andThen(repository.claim(input))
                  ),
              })
            )
          ).pipe(Layer.provide(ReservationAccessRepository.Default));
          const issuance = yield* Effect.forkChild(
            Effect.flatMap(ReservationAccessService, (service) =>
              service.issueRestoredAccess({ reservationId, ...upcoming })
            ).pipe(
              Effect.provide(
                ReservationAccessService.Default.pipe(
                  Layer.provide(
                    Layer.mergeAll(gatedRepository, igloohome.layer)
                  ),
                  Layer.provide(NodeCrypto.layer),
                  Layer.provide(testDatabase.layer)
                )
              )
            )
          );
          yield* Deferred.await(reached);

          const cancelling = yield* Effect.flatMap(
            WorkspaceReservationRepository,
            (reservations) =>
              reservations.claimAdministrationCancellation({
                id: reservationId,
                providerCredentialRemoved: false,
                accessGrantUpdatedAt: null,
                staleCancellingBefore: restoredAt,
              })
          ).pipe(
            Effect.provide(WorkspaceReservationRepository.Default),
            Effect.provide(testDatabase.layer)
          );
          expect(cancelling?.reservationState).toBe("cancelling");
          yield* Deferred.succeed(release, undefined);

          expect(yield* Fiber.join(issuance)).toBe("failed");
        }).pipe(Effect.runPromise);

        expect(igloohome.issueHourlyAlgoPin).not.toHaveBeenCalled();
        expect(await loadGrant(reservationId)).toMatchObject({
          state: "pending",
          provisioningStartedAt: null,
        });
      });

      test.each([
        { name: "a reopened", grant: "expired" },
        { name: "a created", grant: null },
      ] as const)(
        "issues $name grant whose restore committed before issuance ran",
        async ({ grant }) => {
          const reservationId = await insertReservation();
          if (grant) await insertGrant(reservationId, grant);
          expect(await prepare(reservationId)).toBe("issue");

          // The administration retry issues through normal issuance.
          const igloohome = igloohomeIssuing(
            Effect.succeed({
              pin: restoredPin,
              pinId: IgloohomePinIdSchema.make("synthetic-recovered-pin"),
            })
          );
          const issued = await run(
            (service) =>
              service.issueForReservation({ reservationId, ...upcoming }),
            igloohome.layer
          );
          expect(issued.accessStartsAt.equals(upcoming.reservedFrom)).toBe(
            true
          );
          expect((await loadGrant(reservationId))?.state).toBe("issued");
        }
      );
    });
  }
);
