import "server-only";

import {
  DotyposService,
  type DotyposTable,
  ExternalAPIError,
} from "@deskohub/dotypos";
import type { GoogleCalendarEventQuery } from "@deskohub/google-calendar";
import { Effect, Exit, Layer } from "effect";
import { cacheLife, cacheTag } from "next/cache";
import {
  type OccupancyReservation,
  toOccupancyReservation,
} from "@/features/checkout/backend/reservation";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { availabilityTags } from "@/shared/utils/cache-tags";
import { AdvisoryAvailabilityInventory } from "./availability-inventory";
import {
  GoogleCalendarWorkspaceLimitationsService,
  type WorkspaceCalendarLimitation,
} from "./google-calendar-workspace-limitations.service";

/**
 * Serves advisory availability from cross-request snapshots. Each snapshot is
 * fresh for its profile's `revalidate` window, then served stale while it
 * refreshes until `expire`. Failed loads are never cached.
 *
 * The loaders are only referenced inside callbacks: the `"use cache"` compiler
 * turns them into bindings assigned after this layer is evaluated.
 */
export const SharedAvailabilityInventoryLive = Layer.succeed(
  AdvisoryAvailabilityInventory,
  {
    tables: fromSharedSnapshot("getTables", () => loadSharedTables()),
    listActiveReservationsOverlapping: ({ startDate, endDate }) =>
      fromSharedSnapshot("listActiveReservationsOverlapping", () =>
        loadSharedActiveReservations({
          startsAt: startDate.toISOString(),
          endsAt: endDate.toISOString(),
        })
      ),
    listLimitations: ({ from, to }) =>
      fromSharedSnapshot("listLimitations", () =>
        loadSharedLimitations({ from, to })
      ),
  }
);

export async function loadSharedTables(): Promise<readonly DotyposTable[]> {
  "use cache: remote";

  return await Effect.flatMap(DotyposService, (dotypos) =>
    dotypos.getTables()
  ).pipe(
    Effect.provide(WorkspaceDotyposLayer),
    cachedOnSuccess(() => {
      cacheLife("availabilityTables");
      cacheTag(availabilityTags.tables);
    }),
    runWorkspaceEffect("reservation.availability.tables.load")
  );
}

/**
 * Keyed by the Prague-midnight bounds of the requested date range, and keeps
 * only the fields occupancy reads so customer links and notes are not shared.
 */
export async function loadSharedActiveReservations(interval: {
  readonly startsAt: string;
  readonly endsAt: string;
}): Promise<readonly OccupancyReservation[]> {
  "use cache: remote";

  return await Effect.flatMap(DotyposService, (dotypos) =>
    dotypos.listActiveReservationsOverlapping({
      startDate: new Date(interval.startsAt),
      endDate: new Date(interval.endsAt),
    })
  ).pipe(
    Effect.map((reservations) => reservations.map(toOccupancyReservation)),
    Effect.provide(WorkspaceDotyposLayer),
    cachedOnSuccess(() => {
      cacheLife("availabilityReservations");
      cacheTag(availabilityTags.reservations);
    }),
    runWorkspaceEffect("reservation.availability.reservations.load")
  );
}

export async function loadSharedLimitations(
  query: GoogleCalendarEventQuery
): Promise<readonly WorkspaceCalendarLimitation[]> {
  "use cache: remote";

  return await Effect.flatMap(
    GoogleCalendarWorkspaceLimitationsService,
    (calendar) => calendar.listLimitations(query)
  ).pipe(
    Effect.provide(GoogleCalendarWorkspaceLimitationsService.Live),
    cachedOnSuccess(() => {
      cacheLife("availabilityCalendar");
      cacheTag(availabilityTags.calendar);
    }),
    runWorkspaceEffect("reservation.availability.limitations.load")
  );
}

/**
 * Applies a snapshot's lifetime and tag once it loads, and marks any failed
 * load uncacheable so the failure is never shared.
 */
function cachedOnSuccess(applyLifetime: () => void) {
  return <A, E, R>(load: Effect.Effect<A, E, R>) =>
    load.pipe(
      Effect.onExit((exit) =>
        Effect.sync(() =>
          Exit.isSuccess(exit) ? applyLifetime() : cacheLife({ expire: 0 })
        )
      )
    );
}

function fromSharedSnapshot<A>(operation: string, load: () => Promise<A>) {
  return Effect.tryPromise({
    try: load,
    catch: (cause) =>
      new ExternalAPIError({
        service: "availability-inventory",
        operation,
        message: "Shared availability inventory could not be loaded",
        cause,
      }),
  });
}
