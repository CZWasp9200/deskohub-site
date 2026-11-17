import type { DotyposReservation } from "@deskohub/dotypos";
import { Context, Effect, Layer } from "effect";
import {
  type WorkspaceCheckoutNetworkDetails,
  WorkspaceCheckoutNetworkDetailsService,
} from "@/features/checkout/backend/fulfillment/network-details.service";
import type {
  StoredWorkspaceReservationDetails,
  WorkspaceReservationId,
} from "@/features/reservation/persistence-contracts";
import { AdvisoryAvailabilityInventory } from "./availability-inventory";
import {
  type CustomerReservationPlacement,
  getCustomerReservationPlacement,
} from "./customer-reservation-placement";

/**
 * What a booked customer needs on site, as the confirmation email tells
 * them: the table they use and the Wi-Fi.
 */
export type ReservationOnSiteDetails = {
  readonly table?: NonNullable<CustomerReservationPlacement["table"]>;
  readonly network: WorkspaceCheckoutNetworkDetails;
};

/** A confirmed website reservation whose on-site details can be shown. */
export type OnSiteReservation = {
  readonly id: WorkspaceReservationId;
  readonly reservationDetails: StoredWorkspaceReservationDetails;
  readonly dotyposReservation: Pick<DotyposReservation, "_tableId">;
};

interface IReservationOnSite {
  /**
   * Each reservation's table and Wi-Fi. Reads the shared tables snapshot the
   * status page uses, once, and only when there is a reservation to place; a
   * failed read leaves the tables out instead of failing.
   */
  readonly forReservations: (
    reservations: readonly OnSiteReservation[]
  ) => Effect.Effect<ReadonlyMap<WorkspaceReservationId, ReservationOnSiteDetails>>;
}

export class ReservationOnSite extends Context.Service<
  ReservationOnSite,
  IReservationOnSite
>()("@deskohub-workspace/reservation/ReservationOnSite") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const inventory = yield* AdvisoryAvailabilityInventory;
      const networks = yield* WorkspaceCheckoutNetworkDetailsService;

      return {
        forReservations: Effect.fn("ReservationOnSite.forReservations")(
          function* (reservations: readonly OnSiteReservation[]) {
            if (reservations.length === 0) return new Map();
            const tables = yield* inventory.tables.pipe(
              Effect.tapError((cause) =>
                Effect.logWarning("Reservation on-site tables load failed", {
                  cause,
                })
              ),
              Effect.orElseSucceed(() => [])
            );
            const details = yield* Effect.forEach(reservations, (reservation) =>
              networks
                .resolveCustomerNetworkDetails({
                  reservation: { id: reservation.id },
                })
                .pipe(
                  Effect.map((network) => {
                    const { table } = getCustomerReservationPlacement({
                      reservationDetails: reservation.reservationDetails,
                      dotyposReservation: reservation.dotyposReservation,
                      tables,
                      seatingMap: false,
                    });
                    return [
                      reservation.id,
                      { ...(table && { table }), network },
                    ] as const;
                  })
                )
            );
            return new Map(details);
          }
        ),
      };
    })
  );
}
