import { Context, Effect, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { Locale } from "@/features/i18n";
import {
  type IReservationAccessService,
  ReservationAccessService,
} from "@/features/reservation/backend/reservation-access.service";
import type { ReservationAuthorizationService } from "@/features/reservation/backend/reservation-authorization.service";
import { ReservationRecords } from "@/features/reservation/backend/reservation-records";
import { isOpenOnCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { ReviewAccounts, ReviewSandbox } from "@/features/review-accounts";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import {
  currentInstant,
  temporalInstantToIsoString,
} from "@/shared/utils/temporal";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import {
  type CustomerReservationHistoryService,
  type LiveReservationHistoryAccessLookup,
  type LiveReservationHistoryOrder,
  makeCustomerReservationHistory,
} from "./customer-reservation-history.service";
import { ReservationAuthorDirectory } from "./reservation-author-directory.service";

/**
 * The account history read live from Dotypos, whose confirmed bookings with
 * access today carry their door code: the customer API's reservation list.
 * Each code is resolved from the provider record the history just read, so
 * showing it costs no Dotypos read beyond the history's own. It always reads
 * records straight from Dotypos (`ReservationRecords.Provider`), never the
 * shared snapshots customers' AI agents read, which can predate a
 * cancellation. A code that can't be shown leaves its booking without one,
 * and never fails the history. A review account's sandbox shows none.
 */
export class CustomerReservationHistoryWithAccessService extends Context.Service<
  CustomerReservationHistoryWithAccessService,
  CustomerReservationHistoryService["Service"]
>()("@deskohub-workspace/account/CustomerReservationHistoryWithAccessService") {
  static Default = Layer.effect(
    this,
    Effect.flatMap(ReservationAccessService, (access) =>
      makeCustomerReservationHistory(lookupTodayAccess(access))
    )
  ).pipe(Layer.provide(ReservationRecords.Provider));

  /** Shows codes to whom `authorization` lets see them. */
  static withAuthorization = <E, R>(
    authorization: Layer.Layer<ReservationAuthorizationService, E, R>
  ) =>
    this.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          WorkspaceDatabase.Default,
          WorkspaceDotyposLayer,
          CustomerAccountLinkRepository.Live,
          ReservationAuthorDirectory.Live,
          ReviewAccounts.Live,
          ReviewSandbox.Live,
          ReservationAccessService.withAuthorization(authorization)
        )
      )
    );
}

/**
 * Resolves, side by side, the code of every confirmed order whose access
 * starts by today in Prague and hasn't ended.
 */
const lookupTodayAccess = (
  access: IReservationAccessService
): LiveReservationHistoryAccessLookup =>
  Effect.fn("CustomerReservationHistoryWithAccessService.lookupTodayAccess")(
    function* (orders: readonly LiveReservationHistoryOrder[], locale: Locale) {
      const now = yield* currentInstant;
      const resolved = yield* Effect.all(
        orders
          .filter((order) => hasAccessToday(order, now))
          .map((order) =>
            access
              .getAccessWithLiveRecord({
                orderId: order.orderId,
                locale,
                record: order.record,
              })
              .pipe(Effect.map((view) => [order.orderId, view] as const))
          ),
        { concurrency: "unbounded" }
      );
      return new Map(
        resolved.flatMap(([orderId, view]) =>
          view.state === "available"
            ? [
                [
                  orderId,
                  {
                    code: view.code,
                    accessStartsAt: temporalInstantToIsoString(
                      view.accessStartsAt
                    ),
                    accessEndsAt: temporalInstantToIsoString(view.accessEndsAt),
                  },
                ] as const,
              ]
            : []
        )
      );
    }
  );

/** Whether the order's door code works at some point of today in Prague. */
const hasAccessToday = (
  { status, accessInterval }: LiveReservationHistoryOrder,
  now: Temporal.Instant
) =>
  status === "confirmed" &&
  Option.exists(accessInterval, (interval) =>
    isOpenOnCurrentWorkspaceDate(interval, now)
  );
