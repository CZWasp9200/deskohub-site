import {
  IgloohomeDeviceIdSchema,
  type IgloohomeRequestError,
  IgloohomeService,
} from "@deskohub/igloohome";
import { Context, Data, Effect, Layer, Match, Option, Schema } from "effect";
import type { WorkspaceTransaction } from "@/db/database.service";
import { env } from "@/env";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { WorkspaceIgloohomeLayer } from "@/shared/backend/config/igloohome.config";
import { currentInstant } from "@/shared/utils/temporal";
import type {
  IssuedReservationAccess,
  ReservationAccessGrant,
  RestoredReservationAccess,
} from "../reservation-access";
import {
  getRestoredReservationAccess,
  makeReservationAccessName,
  reservationAccessProvisioningStaleAfterMilliseconds,
} from "../reservation-access";
import {
  getIgloohomeAccessWindow,
  isSameIgloohomeAccessWindow,
} from "./igloohome-access-window";
import {
  ReservationAccessRepository,
  type ReservationAccessStorageError,
} from "./reservation-access.repository";

export type ReservationAccessIssuanceOutcome = "rejected" | "uncertain";

/**
 * Why the reservation itself can't get a new code: it has ended, or its span
 * doesn't fit an AlgoPIN. Every other issuance failure has none.
 */
export type ReservationAccessIssuanceRefusal =
  | "reservation-ended"
  | "unrepresentable-interval";

export class ReservationAccessIssuanceError extends Data.TaggedError(
  "ReservationAccessIssuanceError"
)<{
  readonly reservationId: WorkspaceReservationId;
  readonly outcome: ReservationAccessIssuanceOutcome;
  readonly message: string;
  readonly refusal?: ReservationAccessIssuanceRefusal;
  readonly cause?: unknown;
}> {}

/**
 * The access a reservation's door code grants. Workspace records the exact
 * span the reservation holds; the Igloohome window is the whole-hour span the
 * lock is programmed with, which only the provider request uses.
 */
export interface ReservationAccessInterval {
  readonly scheduledStartsAt: Temporal.Instant;
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
  readonly providerStartsAt: string;
  readonly providerEndsAt: string;
}

export const getReservationAccessInterval = (input: {
  readonly reservationId: WorkspaceReservationId;
  readonly reservedFrom: Temporal.Instant;
  readonly reservedUntil: Temporal.Instant;
  readonly now?: Temporal.Instant;
}): Effect.Effect<ReservationAccessInterval, ReservationAccessIssuanceError> =>
  Effect.gen(function* () {
    const now = input.now ?? (yield* currentInstant);

    if (Temporal.Instant.compare(now, input.reservedUntil) >= 0) {
      return yield* new ReservationAccessIssuanceError({
        reservationId: input.reservationId,
        outcome: "rejected",
        message: "AlgoPIN access cannot be issued after the reservation ends.",
        refusal: "reservation-ended",
      });
    }

    const window = getIgloohomeAccessWindow({
      startsAt: input.reservedFrom,
      endsAt: input.reservedUntil,
      now,
    });
    if (Option.isNone(window)) {
      return yield* new ReservationAccessIssuanceError({
        reservationId: input.reservationId,
        outcome: "rejected",
        message: "Reservation cannot be represented by a 1–672 hour AlgoPIN.",
        refusal: "unrepresentable-interval",
      });
    }

    return {
      scheduledStartsAt: input.reservedFrom,
      startsAt: input.reservedFrom,
      endsAt: input.reservedUntil,
      providerStartsAt: window.value.startsAt,
      providerEndsAt: window.value.endsAt,
    };
  });

const hasReservationAccessBounds = (
  grant: ReservationAccessGrant,
  bounds: Pick<
    ReservationAccessGrant,
    "scheduledAccessStartsAt" | "accessStartsAt" | "accessEndsAt"
  >
) =>
  grant.scheduledAccessStartsAt.equals(bounds.scheduledAccessStartsAt) &&
  grant.accessStartsAt.equals(bounds.accessStartsAt) &&
  grant.accessEndsAt.equals(bounds.accessEndsAt);

/** The reservation span a door code is requested for. */
interface ReservationAccessRequest {
  readonly reservationId: WorkspaceReservationId;
  readonly reservedFrom: Temporal.Instant;
  readonly reservedUntil: Temporal.Instant;
}

/** Whether an issued grant's credential covers a reservation span. */
const isProgrammedFor = (
  grant: ReservationAccessGrant,
  reservation: ReservationAccessRequest
) =>
  isSameIgloohomeAccessWindow(
    { startsAt: grant.scheduledAccessStartsAt, endsAt: grant.accessEndsAt },
    { startsAt: reservation.reservedFrom, endsAt: reservation.reservedUntil }
  );

export interface IReservationAccessService {
  readonly loadGrant: (
    reservationId: WorkspaceReservationId
  ) => Effect.Effect<
    ReservationAccessGrant | null,
    ReservationAccessIssuanceError
  >;
  readonly confirmProviderCredentialRemoved: (
    reservationId: WorkspaceReservationId
  ) => Effect.Effect<ReservationAccessGrant, ReservationAccessIssuanceError>;
  readonly issueForReservation: (
    input: ReservationAccessRequest
  ) => Effect.Effect<IssuedReservationAccess, ReservationAccessIssuanceError>;
  /**
   * In the transaction that confirms a cancelled reservation again: locks its
   * grant and plans its access (`getRestoredReservationAccess`). An `issue`
   * plan reopens the expired grant as `pending`, or creates a `pending` one
   * for the reservation's span when it has none, so the reservation commits
   * with a grant that `issueRestoredAccess`, or the administration retry,
   * then issues. Lock the grant before the reservation row, as cancellation
   * does. Other plans write nothing; on `uncertain` the caller refuses the
   * restore.
   */
  readonly prepareRestoredAccess: (
    input: ReservationAccessRequest & { readonly now: Temporal.Instant }
  ) => Effect.Effect<
    RestoredReservationAccess,
    ReservationAccessIssuanceError,
    WorkspaceTransaction
  >;
  /**
   * Issues fresh access for a restored reservation through normal issuance,
   * after its transaction committed. Never fails: a failure leaves the grant
   * `failed`, `uncertain`, `provisioning` or `pending`, which the
   * administration retry accepts, and is reported as `failed`. Calls
   * Igloohome, so run it outside every database transaction.
   */
  readonly issueRestoredAccess: (
    input: ReservationAccessRequest
  ) => Effect.Effect<"issued" | "failed">;
}

export class ReservationAccessService extends Context.Service<
  ReservationAccessService,
  IReservationAccessService
>()("@deskohub-workspace/reservation-access/ReservationAccessService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const repository = yield* ReservationAccessRepository;
      const igloohome = yield* IgloohomeService;
      const deviceId = Schema.decodeUnknownSync(IgloohomeDeviceIdSchema)(
        env.IGLOOHOME_ALGOPIN_TARGET_DEVICE_ID
      );

      /**
       * Presents the PIN of an issued grant programmed for the reservation's
       * hours, first recording the span the reservation now holds.
       */
      const reuseIssued = Effect.fn("ReservationAccessService.reuseIssued")(
        function* (
          issued: ReservationAccessGrant,
          input: ReservationAccessRequest
        ) {
          // A Dotypos timing change within the same hours keeps the PIN,
          // and the grant records the span the reservation now holds.
          const bounds = {
            scheduledAccessStartsAt: input.reservedFrom,
            accessStartsAt: input.reservedFrom,
            accessEndsAt: input.reservedUntil,
          };
          const grant = hasReservationAccessBounds(issued, bounds)
            ? issued
            : yield* repository
                .rescheduleIssued({
                  id: issued.id,
                  reservationId: input.reservationId,
                  from: issued,
                  to: bounds,
                  rescheduledAt: Temporal.Now.instant(),
                })
                .pipe(
                  Effect.mapError(
                    () =>
                      new ReservationAccessIssuanceError({
                        reservationId: input.reservationId,
                        outcome: "rejected",
                        message:
                          "Rescheduled reservation access could not be recorded.",
                      })
                  ),
                  Effect.flatMap((rescheduled) =>
                    rescheduled
                      ? Effect.succeed(rescheduled)
                      : Effect.fail(
                          new ReservationAccessIssuanceError({
                            reservationId: input.reservationId,
                            outcome: "rejected",
                            message:
                              "Reservation access grant changed concurrently.",
                          })
                        )
                  )
                );
          const accessCode = yield* repository
            .loadIssuedCode({
              id: grant.id,
              reservationId: input.reservationId,
              scheduledAccessStartsAt: grant.scheduledAccessStartsAt,
              accessStartsAt: grant.accessStartsAt,
              accessEndsAt: grant.accessEndsAt,
            })
            .pipe(
              Effect.mapError(
                () =>
                  new ReservationAccessIssuanceError({
                    reservationId: input.reservationId,
                    outcome: "rejected",
                    message:
                      "Issued reservation access could not be recovered.",
                  })
              )
            );
          return {
            grantId: grant.id,
            accessCode,
            accessStartsAt: grant.accessStartsAt,
            accessEndsAt: grant.accessEndsAt,
          };
        }
      );

      /**
       * Reuses an issued grant whose credential is still programmed for the
       * reservation's hours. A grant issued for another lock needs operator
       * reconciliation; one programmed for other hours is replaced.
       */
      const reuseIssuedForSameHours = Effect.fnUntraced(function* (
        existingGrant: ReservationAccessGrant | null,
        input: ReservationAccessRequest
      ) {
        if (existingGrant?.state !== "issued") return undefined;
        if (existingGrant.deviceId !== deviceId) {
          yield* repository
            .markUncertain({
              id: existingGrant.id,
              reservationId: input.reservationId,
              failureCode: "reservation_access_device_changed",
              failedAt: Temporal.Now.instant(),
            })
            .pipe(
              Effect.mapError(
                () =>
                  new ReservationAccessIssuanceError({
                    reservationId: input.reservationId,
                    outcome: "uncertain",
                    message:
                      "Changed reservation access could not be reconciled.",
                  })
              )
            );
          return yield* new ReservationAccessIssuanceError({
            reservationId: input.reservationId,
            outcome: "uncertain",
            message: "Reservation access device changed after issuance.",
          });
        }
        // Releases that record the whole hours a lock is programmed with,
        // rather than the exact span, issue grants that compare the same
        // and take the exact span when reused.
        if (isProgrammedFor(existingGrant, input)) {
          return yield* reuseIssued(existingGrant, input);
        }
        return undefined;
      });

      /** Fails a grant another request is provisioning, flagging a stale claim. */
      const failProvisioningGrant = Effect.fnUntraced(function* (
        grant: ReservationAccessGrant,
        input: ReservationAccessRequest
      ) {
        const staleBefore = Temporal.Now.instant().subtract({
          milliseconds: reservationAccessProvisioningStaleAfterMilliseconds,
        });
        if (
          grant.provisioningStartedAt &&
          Temporal.Instant.compare(grant.provisioningStartedAt, staleBefore) <=
            0
        ) {
          yield* repository
            .markUncertain({
              id: grant.id,
              reservationId: input.reservationId,
              failureCode: "stale_provisioning",
              failedAt: Temporal.Now.instant(),
            })
            .pipe(Effect.ignore);
        }
        return yield* new ReservationAccessIssuanceError({
          reservationId: input.reservationId,
          outcome: "uncertain",
          message:
            "Reservation access issuance is in progress or has an unknown outcome.",
        });
      });

      /**
       * Answers for a grant this request can't claim: reuses a PIN a
       * concurrent request issued, or fails. Undefined for a claimable grant.
       */
      const resolveUnclaimableGrant = Effect.fnUntraced(function* (
        grant: ReservationAccessGrant,
        input: ReservationAccessRequest
      ) {
        if (grant.state === "issued") {
          // A concurrent request issued it first. Keep that credential, but
          // never present a PIN programmed for other hours or another lock.
          if (grant.deviceId !== deviceId || !isProgrammedFor(grant, input)) {
            return yield* new ReservationAccessIssuanceError({
              reservationId: input.reservationId,
              outcome: "rejected",
              message: "Reservation access grant changed concurrently.",
            });
          }
          return yield* reuseIssued(grant, input);
        }

        if (grant.state === "uncertain") {
          return yield* new ReservationAccessIssuanceError({
            reservationId: input.reservationId,
            outcome: "uncertain",
            message:
              "Reservation access issuance requires operator reconciliation.",
          });
        }

        if (grant.state === "provisioning") {
          return yield* failProvisioningGrant(grant, input);
        }
        return undefined;
      });

      /** Claims a claimable grant and issues its AlgoPIN. */
      const issueClaimableGrant = Effect.fnUntraced(function* (
        grant: ReservationAccessGrant,
        interval: ReservationAccessInterval,
        input: ReservationAccessRequest
      ) {
        const claimedAt = Temporal.Now.instant();
        // Claiming records the name before the request, so an operator can
        // find a credential whose issuance outcome is unknown.
        const accessName = makeReservationAccessName(grant.id);
        const claimed = yield* repository
          .claim({
            id: grant.id,
            reservationId: input.reservationId,
            scheduledAccessStartsAt: interval.scheduledStartsAt,
            accessStartsAt: interval.startsAt,
            accessEndsAt: interval.endsAt,
            accessName,
            startedAt: claimedAt,
          })
          .pipe(
            Effect.mapError(
              () =>
                new ReservationAccessIssuanceError({
                  reservationId: input.reservationId,
                  outcome: "rejected",
                  message: "Reservation access grant could not be claimed.",
                })
            )
          );
        if (claimed === "taken") {
          return yield* new ReservationAccessIssuanceError({
            reservationId: input.reservationId,
            outcome: "uncertain",
            message: "Reservation access grant was claimed concurrently.",
          });
        }
        if (claimed === "not_issuable") {
          return yield* new ReservationAccessIssuanceError({
            reservationId: input.reservationId,
            outcome: "rejected",
            message: "The reservation is no longer confirmed.",
          });
        }

        const issued = yield* igloohome
          .issueHourlyAlgoPin({
            deviceId,
            variance: 1,
            startsAt: interval.providerStartsAt,
            endsAt: interval.providerEndsAt,
            accessName,
          })
          .pipe(
            Effect.catch(
              Effect.fn(function* (error: IgloohomeRequestError) {
                const failedAt = Temporal.Now.instant();
                const failure = Match.value(error.outcome).pipe(
                  Match.when("ambiguous", () => ({
                    record: repository.markUncertain({
                      id: grant.id,
                      reservationId: input.reservationId,
                      failureCode: "provider_outcome_ambiguous",
                      failedAt,
                    }),
                    error: new ReservationAccessIssuanceError({
                      reservationId: input.reservationId,
                      outcome: "uncertain",
                      message:
                        "Igloohome AlgoPIN issuance outcome is uncertain.",
                    }),
                  })),
                  Match.when("rejected", () => ({
                    record: repository.markFailed({
                      id: grant.id,
                      reservationId: input.reservationId,
                      failureCode: "provider_request_rejected",
                      failedAt,
                    }),
                    error: new ReservationAccessIssuanceError({
                      reservationId: input.reservationId,
                      outcome: "rejected",
                      message: "Igloohome rejected AlgoPIN issuance.",
                    }),
                  })),
                  Match.exhaustive
                );
                yield* failure.record.pipe(Effect.ignore);
                return yield* failure.error;
              })
            )
          );

        const issuedAt = Temporal.Now.instant();
        yield* repository
          .markIssued({
            id: grant.id,
            reservationId: input.reservationId,
            accessCode: issued.pin,
            pinId: issued.pinId,
            issuedAt,
          })
          .pipe(
            Effect.catch((_: ReservationAccessStorageError) =>
              repository
                .markUncertain({
                  id: grant.id,
                  reservationId: input.reservationId,
                  failureCode: "issued_credential_storage_failed",
                  failedAt: Temporal.Now.instant(),
                })
                .pipe(
                  Effect.ignore,
                  Effect.andThen(
                    Effect.fail(
                      new ReservationAccessIssuanceError({
                        reservationId: input.reservationId,
                        outcome: "uncertain",
                        message: "Issued AlgoPIN could not be durably stored.",
                      })
                    )
                  )
                )
            )
          );

        return {
          grantId: grant.id,
          accessCode: issued.pin,
          accessStartsAt: interval.startsAt,
          accessEndsAt: interval.endsAt,
        };
      });

      const issueForReservation = Effect.fn(
        "ReservationAccessService.issueForReservation"
      )(function* (input: ReservationAccessRequest) {
        const existingGrant = yield* repository
          .findByReservationId(input.reservationId)
          .pipe(
            Effect.mapError(
              () =>
                new ReservationAccessIssuanceError({
                  reservationId: input.reservationId,
                  outcome: "rejected",
                  message: "Reservation access grant could not be loaded.",
                })
            )
          );
        const reused = yield* reuseIssuedForSameHours(existingGrant, input);
        if (reused) return reused;

        const interval = yield* getReservationAccessInterval(input);
        const grant = yield* repository
          .ensure({
            reservationId: input.reservationId,
            deviceId,
            scheduledAccessStartsAt: interval.scheduledStartsAt,
            accessStartsAt: interval.startsAt,
            accessEndsAt: interval.endsAt,
            // Only an issued grant moved to other hours reaches here.
            replacingIssued:
              existingGrant?.state === "issued" ? existingGrant : null,
          })
          .pipe(
            Effect.mapError(
              () =>
                new ReservationAccessIssuanceError({
                  reservationId: input.reservationId,
                  outcome: "rejected",
                  message: "Reservation access grant could not be prepared.",
                })
            )
          );

        const settled = yield* resolveUnclaimableGrant(grant, input);
        if (settled) return settled;
        return yield* issueClaimableGrant(grant, interval, input);
      });

      return ReservationAccessService.of({
        loadGrant: (reservationId) =>
          repository.findByReservationId(reservationId).pipe(
            Effect.mapError(
              (cause) =>
                new ReservationAccessIssuanceError({
                  reservationId,
                  outcome: "rejected",
                  message: "Reservation access grant could not be loaded.",
                  cause,
                })
            )
          ),
        confirmProviderCredentialRemoved: (reservationId) => {
          const reconciledAt = Temporal.Now.instant();
          return repository
            .reconcileUncertain({
              reservationId,
              reconciledAt,
              provisioningStaleBefore: reconciledAt.subtract({
                milliseconds:
                  reservationAccessProvisioningStaleAfterMilliseconds,
              }),
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new ReservationAccessIssuanceError({
                    reservationId,
                    outcome: "rejected",
                    message:
                      "Reservation access is not awaiting provider reconciliation.",
                    cause,
                  })
              )
            );
        },
        issueForReservation,
        prepareRestoredAccess: Effect.fn(
          "ReservationAccessService.prepareRestoredAccess"
        )(function* (input) {
          const storageFailure = (cause: ReservationAccessStorageError) =>
            new ReservationAccessIssuanceError({
              reservationId: input.reservationId,
              outcome: "rejected",
              message: "Restored reservation access could not be prepared.",
              cause,
            });
          const grant = yield* repository
            .lockForReservation(input.reservationId)
            .pipe(Effect.mapError(storageFailure));
          const access = getRestoredReservationAccess(grant, input, input.now);
          if (access !== "issue") return access;

          // Only an expired grant plans `issue`.
          const prepared = yield* (
            grant
              ? repository.reopenExpired({
                  id: grant.id,
                  reservationId: input.reservationId,
                  reopenedAt: input.now,
                })
              : repository.createPending({
                  reservationId: input.reservationId,
                  deviceId,
                  scheduledAccessStartsAt: input.reservedFrom,
                  accessStartsAt: input.reservedFrom,
                  accessEndsAt: input.reservedUntil,
                })
          ).pipe(Effect.mapError(storageFailure));
          if (!prepared) {
            return yield* new ReservationAccessIssuanceError({
              reservationId: input.reservationId,
              outcome: "rejected",
              message: "Reservation access grant changed concurrently.",
            });
          }
          return access;
        }),
        issueRestoredAccess: Effect.fn(
          "ReservationAccessService.issueRestoredAccess"
        )((input) =>
          issueForReservation(input).pipe(
            Effect.as("issued" as const),
            Effect.catch((cause) =>
              Effect.logWarning(
                "Restored reservation access could not be issued",
                {
                  reservationId: input.reservationId,
                  outcome: cause.outcome,
                  refusal: cause.refusal,
                }
              ).pipe(Effect.as("failed" as const))
            )
          )
        ),
      });
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(ReservationAccessRepository.Live),
    Layer.provide(WorkspaceIgloohomeLayer)
  );
}
