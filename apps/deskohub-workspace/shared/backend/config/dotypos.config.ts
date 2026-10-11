import {
  DotyposRuntimeConfig,
  DotyposRuntimeConfigSchema,
  DotyposService,
} from "@deskohub/dotypos";
import { Effect, Layer, Schema, Scope } from "effect";
import { env } from "@/env";
import { expireCacheTag } from "@/shared/backend/cache-invalidation";
import { availabilityTags } from "@/shared/utils/cache-tags";

export const WorkspaceDotyposRuntimeConfigLayer = Layer.effect(
  DotyposRuntimeConfig,
  Schema.decodeUnknownEffect(DotyposRuntimeConfigSchema)({
    clientId: env.DOTYPOS_CLIENT_ID,
    clientSecret: env.DOTYPOS_CLIENT_SECRET,
    refreshToken: env.DOTYPOS_REFRESH_TOKEN,
    cloudId: env.DOTYPOS_CLOUD_ID,
    branchId: env.DOTYPOS_BRANCH_ID,
    employeeId: env.DOTYPOS_EMPLOYEE_ID,
    apiUrl: env.DOTYPOS_API_URL,
    apiTimeout: env.DOTYPOS_API_TIMEOUT,
    reservationTableIds: [],
  })
);

/**
 * Every reservation write that changes occupancy marks the shared availability
 * snapshot stale, even when the write fails, because a timed-out write may
 * still have landed. Confirming a hold keeps its seats occupied, so it does not.
 */
export const ReservationWritesExpireAvailability = Layer.effect(
  DotyposService,
  Effect.gen(function* () {
    const dotypos = yield* DotyposService;
    return {
      ...dotypos,
      createReservation: expiringAvailability(dotypos.createReservation),
      updateReservation: expiringAvailability(dotypos.updateReservation),
      cancelReservation: expiringAvailability(dotypos.cancelReservation),
    };
  })
);

const configuredDotyposLayer = ReservationWritesExpireAvailability.pipe(
  Layer.provide(DotyposService.Live),
  Layer.provide(WorkspaceDotyposRuntimeConfigLayer)
);
const processScope = Scope.makeUnsafe();
const processMemoMap = Layer.makeMemoMapUnsafe();

export const WorkspaceDotyposLayer = Layer.fromBuild(() =>
  Layer.buildWithMemoMap(configuredDotyposLayer, processMemoMap, processScope)
);

function expiringAvailability<Args extends readonly unknown[], A, E, R>(
  write: (...args: Args) => Effect.Effect<A, E, R>
) {
  return (...args: Args) =>
    write(...args).pipe(
      Effect.ensuring(expireCacheTag(availabilityTags.reservations))
    );
}
