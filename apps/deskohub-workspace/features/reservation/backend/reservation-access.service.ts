import {
  type DotyposCustomerId,
  type DotyposReservationId,
  DotyposService,
  getCustomerDisplayName,
} from "@deskohub/dotypos";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceCheckoutAccessCodeService } from "@/features/checkout/backend/reservation/access-code.service";
import type { Locale } from "@/features/i18n";
import { decodeBookedReservation } from "@/features/reservation/backend/booked-reservation";
import {
  ReservationAuthorizationService,
  type ReservationViewer,
} from "@/features/reservation/backend/reservation-authorization.service";
import type { ReservationRecord } from "@/features/reservation/backend/reservation-record";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { getDotyposReservationAccessTiming } from "@/features/reservation/backend/workspace-reservation.service";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  getReservationAccessDays,
  type ReservationAccessDays,
} from "@/features/reservation/reservation-access-days";
import type { ReservationAccessToken } from "@/features/reservation/reservation-access-token";
import { ReservationAccessIssuanceError } from "@/features/reservation-access";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";

export type ReservationAccessViewModel =
  | {
      readonly state: "available";
      readonly code: string;
      readonly accessStartsAt: Temporal.Instant;
      readonly accessEndsAt: Temporal.Instant;
      /**
       * The Prague days the code works on, first and last inclusive, when
       * access spans whole days (an office): show these dates alone.
       */
      readonly accessDays?: ReservationAccessDays;
      /** Whom the page shows itself to; an invitee gets the guest view. */
      readonly viewer: ReservationViewer;
      /**
       * Who booked the order, for an invitee's "Booked by" row; null when
       * the name can't be read. Absent for the customer.
       */
      readonly bookedBy?: { readonly name: string | null };
    }
  | { readonly state: "invalid_link" }
  | {
      readonly state: "unavailable";
      readonly reason: ReservationAccessUnavailableReason;
      readonly viewer?: "invitee";
    };

/**
 * Why a code can't be shown: the reservation's state doesn't grant one (not
 * paid or confirmed, or issuance refuses it, such as once it ended), or a
 * lookup it needs failed and a later try may succeed.
 */
type ReservationAccessUnavailableReason = "reservation-state" | "lookup-failed";

/** Who asks for an order's code, as `ReservationAuthorizationService` reads them. */
type ReservationAccessRequest = {
  readonly orderId: WorkspaceReservationId;
  readonly locale: Locale;
  readonly accessCookie?: string;
  readonly accessToken?: ReservationAccessToken;
  /** The cookie an invited person's link was exchanged for. */
  readonly invitationCookie?: string;
};

/** The provider fields that decide whether a reservation's code is shown. */
type ProviderReservationFacts = Pick<
  ReservationRecord,
  "id" | "status" | "startDate" | "endDate" | "seats"
>;

export interface IReservationAccessService {
  readonly getAccess: (
    input: ReservationAccessRequest
  ) => Effect.Effect<ReservationAccessViewModel>;
  /**
   * `getAccess` for an order whose Dotypos reservation the caller has just
   * read live, such as the account history: the same checks and issuance,
   * without reading Dotypos again. Never pass a shared snapshot, which can
   * predate a cancellation.
   */
  readonly getAccessWithLiveRecord: (
    input: ReservationAccessRequest & {
      readonly record: ProviderReservationFacts;
    }
  ) => Effect.Effect<ReservationAccessViewModel>;
}

const invalidLinkAccess: ReservationAccessViewModel = { state: "invalid_link" };
const unavailableAccess = (
  reason: ReservationAccessUnavailableReason,
  viewer: ReservationViewer
): ReservationAccessViewModel => ({
  state: "unavailable",
  reason,
  ...(viewer === "invitee" && { viewer }),
});

/**
 * Bounds the live Dotypos lookup, including its retries, well inside the
 * access route's 30-second `maxDuration`, so a slow Dotypos still lets the
 * page render its unavailable state. Matches the status page's cap.
 */
const providerLookupDeadline = "8 seconds";

const implementation = Effect.gen(function* () {
  const reservations = yield* WorkspaceReservationRepository;
  const authorization = yield* ReservationAuthorizationService;
  const dotypos = yield* DotyposService;
  const accessCodes = yield* WorkspaceCheckoutAccessCodeService;

  const annotateRequest = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    input: ReservationAccessRequest
  ) =>
    effect.pipe(
      Effect.annotateLogs({
        orderId: input.orderId,
        locale: input.locale,
        hasAccessCookie: input.accessCookie !== undefined,
        hasAccessToken: input.accessToken !== undefined,
      })
    );

  /**
   * The order's local row, when the requester may see its code and the order
   * is paid, confirmed, and placed in Dotypos; otherwise the answer.
   */
  const findGrantedReservation = Effect.fn(function* (
    input: ReservationAccessRequest
  ) {
    const viewer = yield* authorization
      .authorizeViewer({ ...input, permission: "view-access-code" })
      .pipe(Effect.orElseSucceed(() => Option.none<ReservationViewer>()));
    if (Option.isNone(viewer)) return invalidLinkAccess;

    const reservation = yield* reservations.findById(input.orderId).pipe(
      Effect.map((found) => found ?? "missing"),
      Effect.tapError(() =>
        Effect.logWarning("Reservation access lookup failed")
      ),
      Effect.orElseSucceed(() => "failed" as const)
    );
    if (reservation === "failed")
      return unavailableAccess("lookup-failed", viewer.value);
    if (
      reservation === "missing" ||
      reservation.paymentState !== "paid" ||
      reservation.reservationState !== "confirmed" ||
      !reservation.dotyposReservationId
    ) {
      return unavailableAccess("reservation-state", viewer.value);
    }
    return {
      state: "granted" as const,
      reservation,
      dotyposReservationId: reservation.dotyposReservationId,
      viewer: viewer.value,
    };
  });

  /** The code of a granted order whose Dotypos reservation reads `record`. */
  const resolveCode = Effect.fn(function* ({
    reservation,
    dotyposReservationId,
    record,
    viewer,
  }: {
    readonly reservation: WorkspaceReservation;
    readonly dotyposReservationId: DotyposReservationId;
    readonly record: ProviderReservationFacts | undefined;
    readonly viewer: ReservationViewer;
  }) {
    if (record?.status !== "CONFIRMED") {
      return unavailableAccess("reservation-state", viewer);
    }

    const timing = yield* getDotyposReservationAccessTiming({
      reservationId: reservation.id,
      reservation: decodeBookedReservation(
        record,
        reservation.reservationDetails
      ),
    }).pipe(
      Effect.tapError(() =>
        Effect.logWarning("Reservation access timing is invalid")
      ),
      Effect.orElseSucceed(() => undefined)
    );
    if (!timing) return unavailableAccess("lookup-failed", viewer);

    const bookedBy =
      viewer === "invitee"
        ? { name: yield* readBookerName(reservation.dotyposCustomerId) }
        : undefined;

    return yield* accessCodes
      .resolveCustomerAccessCode({
        reservationId: reservation.id,
        dotyposReservationId,
        ...timing,
      })
      .pipe(
        Effect.flatMap((access) =>
          Schema.decodeUnknownEffect(Schema.NonEmptyString)(access.code).pipe(
            Effect.map((code): ReservationAccessViewModel => {
              const accessDays = getReservationAccessDays(access);
              return {
                state: "available",
                code,
                accessStartsAt: access.accessStartsAt,
                accessEndsAt: access.accessEndsAt,
                ...(accessDays && { accessDays }),
                viewer,
                ...(bookedBy && { bookedBy }),
              };
            })
          )
        ),
        Effect.tapError(() =>
          Effect.logError("Reservation access code resolution failed")
        ),
        Effect.catch((failure) =>
          Effect.succeed(
            unavailableAccess(
              failure instanceof ReservationAccessIssuanceError &&
                failure.refusal
                ? "reservation-state"
                : "lookup-failed",
              viewer
            )
          )
        )
      );
  });

  /** The booker's display name, for an invitee; null when unreadable. */
  const readBookerName = (
    customerId: WorkspaceReservation["dotyposCustomerId"]
  ) =>
    dotypos.getCustomer(customerId as DotyposCustomerId).pipe(
      Effect.map((found) =>
        Option.getOrNull(
          Option.flatMapNullishOr(found, (customer) =>
            getCustomerDisplayName(customer)
          )
        )
      ),
      Effect.timeoutOrElse({
        duration: providerLookupDeadline,
        orElse: () => Effect.succeed(null),
      }),
      Effect.tapError(() =>
        Effect.logWarning("Reservation access booker lookup failed")
      ),
      Effect.orElseSucceed(() => null)
    );

  const readProviderReservation = (id: DotyposReservationId) =>
    dotypos.getReservation(id).pipe(
      Effect.map((found) =>
        Option.getOrUndefined(Option.map(found, (read) => read.reservation))
      ),
      Effect.timeoutOrElse({
        duration: providerLookupDeadline,
        orElse: () =>
          Effect.logWarning(
            "Reservation access provider lookup timed out"
          ).pipe(Effect.as("failed" as const)),
      }),
      Effect.tapError(() =>
        Effect.logWarning("Reservation access provider lookup failed")
      ),
      Effect.orElseSucceed(() => "failed" as const)
    );

  const getAccess = Effect.fn("ReservationAccessService.getAccess")(function* (
    input: ReservationAccessRequest
  ) {
    const granted = yield* findGrantedReservation(input);
    if (granted.state !== "granted") return granted;

    const record = yield* readProviderReservation(granted.dotyposReservationId);
    if (record === "failed")
      return unavailableAccess("lookup-failed", granted.viewer);

    return yield* resolveCode({ ...granted, record });
  }, annotateRequest);

  const getAccessWithLiveRecord = Effect.fn(
    "ReservationAccessService.getAccessWithLiveRecord"
  )(function* ({
    record,
    ...input
  }: ReservationAccessRequest & {
    readonly record: ProviderReservationFacts;
  }) {
    const granted = yield* findGrantedReservation(input);
    if (granted.state !== "granted") return granted;
    // A record of another reservation says nothing about this order's.
    if (record.id !== granted.dotyposReservationId) {
      return unavailableAccess("lookup-failed", granted.viewer);
    }

    return yield* resolveCode({ ...granted, record });
  }, annotateRequest);

  return {
    getAccess,
    getAccessWithLiveRecord,
  } satisfies IReservationAccessService;
});

export class ReservationAccessService extends Context.Service<
  ReservationAccessService,
  IReservationAccessService
>()("@deskohub-workspace/reservation/ReservationAccessService") {
  static Default = Layer.effect(this, implementation);

  /**
   * The service deciding who may see a code through `authorization`, such as
   * one reading the customer API's session.
   */
  static withAuthorization = <E, R>(
    authorization: Layer.Layer<ReservationAuthorizationService, E, R>
  ) =>
    this.Default.pipe(
      Layer.provide(WorkspaceReservationRepository.Default),
      Layer.provide(authorization),
      Layer.provide(WorkspaceDatabase.Default),
      Layer.provide(WorkspaceDotyposLayer),
      Layer.provide(WorkspaceCheckoutAccessCodeService.Live)
    );

  static Live = this.withAuthorization(ReservationAuthorizationService.Live);
}
