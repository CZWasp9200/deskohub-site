import "server-only";

import { Effect, Option } from "effect";
import {
  type AdvertisedPriceRequest,
  advertisedPriceRequestEquals,
  type PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import { buildAdvertisedPrice } from "@/features/checkout/backend/checkout/advertised-price.server";
import { OfficeReservationFeatureFlagRenderLayer } from "@/features/office/backend/office-reservation-feature-flag.server";

export const loadAdvertisedPrices = Effect.fn(
  "reservation.loadAdvertisedPrices"
)(function* (requests: ReadonlyArray<AdvertisedPriceRequest>) {
  const uniqueRequests = requests.filter(
    (request, index) =>
      requests.findIndex((candidate) =>
        advertisedPriceRequestEquals(candidate, request)
      ) === index
  );
  const results = yield* Effect.all(
    uniqueRequests.map((request) =>
      buildAdvertisedPrice(request).pipe(
        Effect.provide(OfficeReservationFeatureFlagRenderLayer),
        Effect.tapError(() =>
          Effect.logError("Advertised price load failed", {
            reservationKind: request.reservation.kind,
          })
        ),
        Effect.option,
        Effect.map(
          Option.map(
            (advertisedPrice): PreloadedAdvertisedPrice => ({
              request,
              advertisedPrice,
            })
          )
        )
      )
    ),
    { concurrency: 6 }
  );

  return results.filter(Option.isSome).map(({ value }) => value);
});
