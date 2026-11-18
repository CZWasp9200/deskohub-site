import {
  type DotyposCustomerId,
  DotyposReservationIdSchema,
  DotyposService,
  getCustomerDisplayName,
} from "@deskohub/dotypos";
import type {
  CustomerInvitedReservation,
  CustomerInvitedReservations,
} from "@deskohub/workspace-customer-api";
import { Context, Effect, Layer, Option } from "effect";
import {
  WorkspaceDatabase,
  workspaceStatementConcurrency,
} from "@/db/database.service";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
import { CustomerAccountLinkRepository } from "@/features/account/backend/customer-account-link.repository";
import {
  getLocalReservationStatus,
  getReservationStatus,
} from "@/features/account/backend/customer-reservation-history.service";
import { getReservationProductName } from "@/features/account/reservation-product-name";
import type { Locale } from "@/features/i18n";
import { decodeBookedReservation } from "@/features/reservation/backend/booked-reservation";
import { ReservationAccessService } from "@/features/reservation/backend/reservation-access.service";
import { ReservationRecords } from "@/features/reservation/backend/reservation-records";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { getDotyposReservationAccessTiming } from "@/features/reservation/backend/workspace-reservation.service";
import { isOpenOnCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { ReservationInvitees } from "@/features/reservation-invitees/backend/reservation-invitees.service";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { currentInstant } from "@/shared/utils/temporal";

const makeInvitedReservations = Effect.gen(function* () {
  const accounts = yield* CurrentCustomerAccount;
  const links = yield* CustomerAccountLinkRepository;
  const invitees = yield* ReservationInvitees;
  const reservations = yield* WorkspaceReservationRepository;
  const records = yield* ReservationRecords;
  const access = yield* ReservationAccessService;
  const dotypos = yield* DotyposService;

  const readBooker = (customerId: DotyposCustomerId) =>
    dotypos.getCustomer(customerId).pipe(
      Effect.map((found) =>
        Option.getOrNull(Option.flatMapNullishOr(found, getCustomerDisplayName))
      ),
      Effect.timeoutOrElse({
        duration: "8 seconds",
        orElse: () => Effect.succeed(null),
      }),
      Effect.orElseSucceed(() => null)
    );

  const load = Effect.fn("customerInvitedReservations.load")(function* (
    locale: Locale
  ) {
    const viewer = yield* accounts.requireActive;
    const dotyposCustomerId = yield* links.find(viewer.accountId);
    const orderIds = yield* invitees.findInvitedReservations({
      accountId: viewer.accountId,
      email: viewer.email,
      dotyposCustomerId,
    });
    const concurrency = yield* workspaceStatementConcurrency;
    const stored = yield* Effect.forEach(orderIds, reservations.findById, {
      concurrency,
    });
    const orders = stored.flatMap((row) =>
      row?.reservationDetails.kind === "office" &&
      row.dotyposReservationId &&
      (row.paymentState === "paid" || row.reservationConfirmedAt !== null) &&
      row.authorAccountId !== viewer.accountId &&
      row.dotyposCustomerId !== dotyposCustomerId
        ? [
            {
              row,
              providerId: DotyposReservationIdSchema.make(
                row.dotyposReservationId
              ),
            },
          ]
        : []
    );
    const live = yield* records.listByIds(
      orders.map(({ providerId }) => providerId)
    );
    const liveById = new Map(live.map((record) => [record.id, record]));
    const now = yield* currentInstant;
    const product = { kind: "office" } as const;
    const productName = getReservationProductName(product, locale);
    const bookers = yield* Effect.forEach(
      [...new Set(orders.map(({ row }) => row.dotyposCustomerId))],
      (id) =>
        readBooker(id as DotyposCustomerId).pipe(
          Effect.map((name) => [id, name] as const)
        ),
      { concurrency }
    );
    const bookerNames = new Map(bookers);
    const entries = yield* Effect.forEach(
      orders,
      Effect.fnUntraced(function* ({
        row,
        providerId,
      }: (typeof orders)[number]) {
        const record = liveById.get(providerId);
        const status = record
          ? getReservationStatus(record, row)
          : (getLocalReservationStatus(row) ?? "requires-attention");
        const timing = record
          ? yield* getDotyposReservationAccessTiming({
              reservationId: row.id,
              reservation: decodeBookedReservation(
                record,
                row.reservationDetails
              ),
            }).pipe(Effect.option)
          : Option.none();
        const window = Option.getOrNull(timing);
        const today =
          record &&
          status === "confirmed" &&
          window &&
          isOpenOnCurrentWorkspaceDate(
            {
              startsAt: window.reservedFrom,
              endsAt: window.reservedUntil,
            },
            now
          )
            ? yield* access.getAccessWithLiveRecord({
                orderId: row.id,
                locale,
                record,
              })
            : undefined;

        return {
          entry: {
            orderId: row.id,
            product,
            productName,
            status,
            accessStartsAt: window?.reservedFrom.toString() ?? null,
            accessEndsAt: window?.reservedUntil.toString() ?? null,
            bookedBy: {
              name: bookerNames.get(row.dotyposCustomerId) ?? null,
            },
            ...(today?.state === "available" && {
              todayAccess: {
                code: today.code,
                accessStartsAt: today.accessStartsAt.toString(),
                accessEndsAt: today.accessEndsAt.toString(),
              },
            }),
          } satisfies CustomerInvitedReservation,
          ended:
            status === "cancelled" ||
            (window !== null &&
              Temporal.Instant.compare(window.reservedUntil, now) <= 0),
          startsAt: window?.reservedFrom,
        };
      }),
      { concurrency }
    );
    const sorted = entries.toSorted((left, right) => {
      if (!left.startsAt) return right.startsAt ? 1 : 0;
      if (!right.startsAt) return -1;
      return Temporal.Instant.compare(right.startsAt, left.startsAt);
    });
    return {
      current: sorted.filter(({ ended }) => !ended).map(({ entry }) => entry),
      past: sorted.filter(({ ended }) => ended).map(({ entry }) => entry),
    } satisfies CustomerInvitedReservations;
  });

  return { load };
});

export class CustomerInvitedReservationsService extends Context.Service<
  CustomerInvitedReservationsService,
  Effect.Success<typeof makeInvitedReservations>
>()("@deskohub-workspace/customer-api/CustomerInvitedReservationsService") {
  static withAccess = <E, AccountError>(
    access: Layer.Layer<ReservationAccessService, E>,
    account: Layer.Layer<CurrentCustomerAccount, AccountError>
  ) => {
    return Layer.effect(
      CustomerInvitedReservationsService,
      makeInvitedReservations
    ).pipe(
      Layer.provide(
        Layer.mergeAll(
          access,
          account,
          CustomerAccountLinkRepository.Live,
          ReservationInvitees.Default,
          ReservationRecords.Live,
          WorkspaceDotyposLayer,
          WorkspaceReservationRepository.Default.pipe(
            Layer.provide(WorkspaceDatabase.Default)
          )
        )
      )
    );
  };
}
