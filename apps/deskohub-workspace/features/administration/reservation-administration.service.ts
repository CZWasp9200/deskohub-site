import { DotyposService } from "@deskohub/dotypos";
import { Context, Data, Effect, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { CustomerEmailLocaleService } from "@/features/account";
import { WorkspaceCheckoutNetworkDetailsService } from "@/features/checkout/backend/fulfillment/network-details.service";
import { WorkspaceReservationEmailService } from "@/features/checkout/backend/fulfillment/workspace-reservation-email.service";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend/workspace-feature-flag.service";
import {
  ReservationCancellation,
  type ReservationCancellationFailureReason,
} from "@/features/reservation/backend/reservation-cancellation.service";
import { SeatingMapReleaseGate } from "@/features/reservation/backend/seating-map-release-gate";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { WorkspaceReservationService } from "@/features/reservation/backend/workspace-reservation.service";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { WorkspaceEmailLayer } from "@/shared/backend/config/email.config";
import { servicePerOperation } from "@/shared/backend/service-per-operation";

type ReservationCancellationResult = {
  readonly outcome: "cancelled" | "already_cancelled";
  readonly email: "not_requested" | "sent" | "failed";
};

export class ReservationAdministrationError extends Data.TaggedError(
  "ReservationAdministrationError"
)<{
  readonly code: "not_found" | "not_cancellable" | "cancellation_failed";
  /** Why the cancellation stopped, so the Admin UI can explain it in the operator's language. */
  readonly reason: ReservationCancellationFailureReason;
  readonly message: string;
  readonly cause?: unknown;
}> {}

type ReservationCancellationInput = {
  readonly force?: boolean;
  readonly reservationId: WorkspaceReservationId;
  readonly sendCancellationEmail: boolean;
};

interface IReservationAdministrationService {
  readonly cancel: (
    input: ReservationCancellationInput
  ) => Effect.Effect<
    ReservationCancellationResult,
    ReservationAdministrationError
  >;
}

export class ReservationAdministrationService extends Context.Service<
  ReservationAdministrationService,
  IReservationAdministrationService
>()("@deskohub-workspace/administration/ReservationAdministrationService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const cancellation = yield* ReservationCancellation;
      const emails = yield* WorkspaceReservationEmailService;

      return {
        cancel: Effect.fn("ReservationAdministrationService.cancel")(
          function* (input) {
            const cancelled = yield* cancellation
              .cancel({
                reservationId: input.reservationId,
                cause: "operator",
                ...(input.force !== undefined && { force: input.force }),
              })
              .pipe(
                Effect.mapError(
                  ({ code, reason, message, cause }) =>
                    new ReservationAdministrationError({
                      code,
                      reason,
                      message,
                      ...(cause !== undefined && { cause }),
                    })
                )
              );
            if (cancelled.outcome === "already_cancelled") {
              return {
                outcome: "already_cancelled",
                email: "not_requested",
              };
            }
            return {
              outcome: "cancelled",
              email: yield* sendLoadedCancellationEmail({
                send: input.sendCancellationEmail,
                details: cancelled.reservation,
                emails,
              }),
            };
          }
        ),
      } satisfies IReservationAdministrationService;
    })
  );

  /**
   * The service as an administration API serves it. An administration API
   * builds its services once per process, so each cancellation builds its
   * own seating-map release decision and the reservation details read over
   * it, which would otherwise reach every later request. `shared` holds no
   * request state: it builds once with the returned Layer, and every
   * cancellation takes that instance.
   */
  static perOperationOver = <E, R>(
    shared: Layer.Layer<
      | DotyposService
      | WorkspaceFeatureFlagService
      | WorkspaceReservationEmailService
      | WorkspaceReservationRepository,
      E,
      R
    >
  ) =>
    servicePerOperation(
      this,
      { cancel: true },
      this.Default.pipe(
        Layer.provide(ReservationCancellation.Default),
        Layer.provide(WorkspaceReservationService.Default),
        Layer.provide(SeatingMapReleaseGate.Default)
      )
    ).pipe(Layer.provide(shared));

  static Live = this.perOperationOver(
    Layer.mergeAll(
      WorkspaceReservationEmailService.Default.pipe(
        Layer.provide(
          Layer.provideMerge(
            Layer.provideMerge(
              WorkspaceEmailLayer,
              WorkspaceCheckoutNetworkDetailsService.Default
            ),
            CustomerEmailLocaleService.Live
          )
        )
      ),
      WorkspaceReservationRepository.Default,
      WorkspaceDotyposLayer,
      WorkspaceFeatureFlagService.Default
    ).pipe(Layer.provide(WorkspaceDatabase.Default))
  );
}

type IWorkspaceReservationEmailService =
  WorkspaceReservationEmailService["Service"];

const sendLoadedCancellationEmail = ({
  details,
  emails,
  send,
}: {
  readonly details: Parameters<
    IWorkspaceReservationEmailService["sendCancellationEmail"]
  >[0]["reservation"];
  readonly emails: IWorkspaceReservationEmailService;
  readonly send: boolean;
}) =>
  emails.sendCancellationEmail({ reservation: details }).pipe(
    Effect.as("sent" as const),
    Effect.orElseSucceed(() => "failed" as const),
    Effect.when(Effect.succeed(send)),
    Effect.map(Option.getOrElse(() => "not_requested" as const))
  );
