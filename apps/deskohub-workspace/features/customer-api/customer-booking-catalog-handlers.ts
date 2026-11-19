import "server-only";

import {
  type CustomerAvailability,
  type CustomerBookingOfferings,
  type CustomerBookingQuote,
  CustomerBookingSelectionInvalid,
  type CustomerBookingSelectionQuery,
  type CustomerOffering,
  customerAvailabilityReplacementHeader,
} from "@deskohub/workspace-customer-api";
import { Data, Effect, Layer, Match, Option, Struct } from "effect";
import { buildAdvertisedPrice } from "@/features/checkout/backend/checkout/advertised-price.server";
import { loadPublicOfferings } from "@/features/checkout/backend/checkout/public-offerings";
import { getMeetingRoomCheckoutSummary } from "@/features/checkout/checkout-summary-meeting-room";
import {
  getPublicOpeningHours,
  type PublicOffering,
} from "@/features/checkout/public-offerings";
import { getReservationQuoteDiscount } from "@/features/checkout/reservation-quote-schema";
import type { Locale } from "@/features/i18n";
import { getPaymentSubmitLegalDocuments } from "@/features/legal/payment-submit-evidence";
import { MeetingRoomReleaseGate } from "@/features/meeting-room/backend/meeting-room-release-gate";
import { resolveBookingQuoteSelection } from "@/features/reservation/backend/booking-selection";
import { OvernightStayReleaseGate } from "@/features/reservation/backend/overnight-stay-release-gate";
import { AvailabilityQueryInvalid } from "@/features/reservation/backend/workspace-availability.service";
import {
  loadAvailability,
  loadMeetingRoomStartTimes,
  loadMeetingRoomUnavailableDates,
} from "@/features/reservation/backend/workspace-availability-loader";
import { getBookableDates } from "@/features/reservation/bookable-dates";
import {
  getOvernightStayTimes,
  overnightCoworkStayTier,
} from "@/features/reservation/cowork-stay";
import { getMeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { coworkReservationKind } from "@/features/reservation/reservation-kind";
import {
  getMeetingRoomUnavailableDatesQuery,
  parseMeetingRoomStartTimesQuery,
  parseWorkspaceAvailabilityQuery,
  type WorkspaceAvailability,
  type WorkspaceAvailabilityQuery,
} from "@/features/reservation/workspace-availability";
import { providePerRequest } from "@/shared/backend/provide-per-request";
import { currentInstant } from "@/shared/utils/temporal";
import {
  answerSessionApiFailure,
  type CustomerSessionApiFailure,
} from "./customer-api-failure";
import { CustomerBookingCatalogLayers } from "./customer-booking-catalog-layers";
import type {
  CustomerBookingEndpointName,
  CustomerBookingHandlers,
} from "./customer-booking-endpoint";
import {
  answerBookingSelectionFailure,
  toBookingSelectionInput,
  withEarlySetup,
} from "./customer-booking-selection";
import { toCustomerCheckoutSummary } from "./customer-checkout-summary";

/**
 * A public sale source couldn't answer, so the prices may miss a sale. The
 * booking pages still show them; the API answers unavailable instead, so a
 * client retries rather than starting checkout from a price that changes.
 */
class SalePricesUnavailable extends Data.TaggedError("SalePricesUnavailable") {}

/** The booking catalog's endpoints, which a booking reads before checkout. */
export type CustomerBookingCatalogEndpointName =
  | "listOfferings"
  | "getAvailability"
  | "getMeetingRoomStartTimes"
  | "getMeetingRoomUnavailableDates"
  | "getQuote"
  | "listLegalDocuments";

/**
 * Attaches the booking catalog's handlers. Each endpoint builds its read
 * from `CustomerBookingCatalogLayers` and answers a read that fails as
 * unavailable; offerings and availability read the same shared snapshots
 * the booking pages read. The offerings and the quote read release gates,
 * so they build their Layers per request with `providePerRequest`;
 * availability's Layers keep nothing for a request.
 *
 * The offerings list the meeting room only while its release gate is open,
 * as the office only while office reservations are. The meeting room's start
 * times and quotes still answer, since the website's reservation page still
 * books it while the gate hides it.
 */
export const handleCustomerBookingCatalog = <R>(
  handlers: CustomerBookingHandlers<
    R,
    Exclude<CustomerBookingEndpointName, CustomerBookingCatalogEndpointName>
  >
) =>
  Effect.gen(function* () {
    const { pricing, inventory, availability, sealedStateKeys, releases } =
      yield* CustomerBookingCatalogLayers;

    /**
     * What the offerings read: anonymous prices, the office capacity, and
     * the gates that decide which offerings the catalog lists.
     */
    const offerings = Layer.mergeAll(
      pricing.pipe(Layer.provideMerge(releases.referral)),
      inventory,
      releases.meetingRoom,
      releases.office,
      releases.overnightStay
    );

    /**
     * What a quote reads beyond the offerings: the keys that seal it for the
     * checkout it starts.
     */
    const quoting = Layer.mergeAll(offerings, sealedStateKeys);

    return handlers
      .handle("listOfferings", ({ query: { locale } }) =>
        loadPublicOfferings(locale).pipe(
          Effect.filterOrFail(
            ({ complete }) => complete,
            () => new SalePricesUnavailable()
          ),
          Effect.bind(
            "overnightStayOffered",
            () => OvernightStayReleaseGate.isOpen
          ),
          Effect.bind(
            "meetingRoomOffered",
            () => MeetingRoomReleaseGate.isOpen
          ),
          Effect.map(
            (listing): CustomerBookingOfferings => ({
              advertisedOn: listing.advertisedOn.toString(),
              openingHours: getPublicOpeningHours(locale),
              offerings: listing.offerings
                .filter(
                  ({ kind }) =>
                    kind !== "meeting-room" || listing.meetingRoomOffered
                )
                .map((offering) => toCustomerOffering(offering, listing)),
            })
          ),
          providePerRequest(offerings),
          answerSessionApiFailure("customerApi.listOfferings")
        )
      )
      .handle("getAvailability", ({ query, headers }) =>
        parseAvailabilityQuery(
          parseWorkspaceAvailabilityQuery,
          new URLSearchParams(definedEntries(query))
        ).pipe(
          Effect.tap(ensureAvailabilityStayOffered(releases.overnightStay)),
          Effect.flatMap((parsed) =>
            loadAvailability({
              query: parsed,
              replacementToken: headers[customerAvailabilityReplacementHeader],
            }).pipe(
              Effect.map(toCustomerAvailability),
              Effect.provide(availability),
              answerSessionApiFailure("customerApi.getAvailability")
            )
          )
        )
      )
      .handle("getMeetingRoomStartTimes", ({ query, headers }) =>
        parseAvailabilityQuery(
          parseMeetingRoomStartTimesQuery,
          new URLSearchParams({
            kind: "meeting-room",
            mode: "start-times",
            ...query,
          })
        ).pipe(
          Effect.flatMap((parsed) =>
            loadMeetingRoomStartTimes({
              query: parsed,
              replacementToken: headers[customerAvailabilityReplacementHeader],
            }).pipe(
              Effect.provide(availability),
              answerSessionApiFailure("customerApi.getMeetingRoomStartTimes")
            )
          )
        )
      )
      .handle("getMeetingRoomUnavailableDates", ({ query, headers }) =>
        currentInstant.pipe(
          Effect.flatMap((now) =>
            loadMeetingRoomUnavailableDates({
              query: getMeetingRoomUnavailableDatesQuery({
                ...query,
                today: getCurrentWorkspaceDate(now).toString(),
              }),
              replacementToken: headers[customerAvailabilityReplacementHeader],
            })
          ),
          Effect.provide(availability),
          answerAvailabilityRangeFailure(
            "customerApi.getMeetingRoomUnavailableDates"
          )
        )
      )
      .handle("getQuote", ({ query }) =>
        quoteSelection(query).pipe(
          providePerRequest(quoting),
          answerBookingSelectionFailure("customerApi.getQuote")
        )
      )
      .handle("listLegalDocuments", ({ query: { locale } }) =>
        Effect.succeed({ documents: getPaymentSubmitLegalDocuments(locale) })
      );
  });

type QuoteQuery = typeof CustomerBookingSelectionQuery.Type & {
  readonly locale: Locale;
  readonly earlySetup?: "true" | "false";
};

/**
 * Prices a selection the way the agent tools' `get_quote` does: resolved as
 * the booking pages accept it, then advertised anonymously, with the signed
 * quote a checkout starts from.
 */
const quoteSelection = Effect.fn("customerApi.quoteSelection")(function* (
  query: QuoteQuery
) {
  const now = yield* currentInstant;
  const { locale: _locale, coffee, earlySetup, ...fields } = query;
  const selection = yield* resolveBookingQuoteSelection({
    selection: yield* toBookingSelectionInput({
      ...fields,
      ...(coffee !== undefined && { coffee: coffee === "true" }),
    }),
    locale: query.locale,
    now,
  });
  const reservation = yield* withEarlySetup(selection, earlySetup === "true");
  const advertised = yield* buildAdvertisedPrice(selection.request);
  if (!advertised.discountsComplete) return yield* new SalePricesUnavailable();
  const { payment } = advertised.quote;
  const summary =
    advertised.kind === "meeting-room" && reservation.kind === "meeting-room"
      ? getMeetingRoomCheckoutSummary(advertised.quote, reservation)
      : advertised.summary;

  return {
    family: advertised.kind,
    total: payment.expectedPrice,
    regularPrice: payment.undiscountedPrice,
    discount: getReservationQuoteDiscount(payment),
    quotedAt: now.toString(),
    summary: toCustomerCheckoutSummary(summary),
    advertisedPriceToken: advertised.advertisedPriceToken,
  } satisfies CustomerBookingQuote;
});

/**
 * An overnight availability query is invalid while overnight stays are not
 * offered, as a quote or checkout for one is.
 */
const ensureAvailabilityStayOffered =
  (overnightStayRelease: Layer.Layer<OvernightStayReleaseGate>) =>
  (query: WorkspaceAvailabilityQuery) =>
    query.kind === coworkReservationKind && query.stay === "overnight"
      ? OvernightStayReleaseGate.isOpen.pipe(
          Effect.filterOrFail(
            (open) => open,
            () => new CustomerBookingSelectionInvalid({ field: "stay" })
          ),
          Effect.asVoid,
          providePerRequest(overnightStayRelease)
        )
      : Effect.void;

/**
 * Reads the query the way the availability route does, so both accept the
 * same combinations. The contract already checked each value's format; what
 * the route's parser still refuses, such as a meeting-room interval no
 * booking spans, is invalid.
 */
const parseAvailabilityQuery = <Query>(
  parse: (searchParams: URLSearchParams) => Option.Option<Query>,
  searchParams: URLSearchParams
): Effect.Effect<Query, CustomerBookingSelectionInvalid> =>
  Option.match(parse(searchParams), {
    onNone: () => Effect.fail(new CustomerBookingSelectionInvalid({})),
    onSome: Effect.succeed,
  });

/**
 * Answers a range the availability service refuses, such as one longer than
 * the calendar, as an invalid selection, and every other failure as
 * `answerSessionApiFailure` does.
 */
const answerAvailabilityRangeFailure =
  (operation: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.catch(
        (
          failure
        ): Effect.Effect<
          never,
          | CustomerBookingSelectionInvalid
          | CustomerSessionApiFailure<Exclude<E, AvailabilityQueryInvalid>>
        > =>
          failure instanceof AvailabilityQueryInvalid
            ? Effect.fail(new CustomerBookingSelectionInvalid({}))
            : Effect.fail(failure).pipe(answerSessionApiFailure(operation))
      )
    );

const definedEntries = (
  query: Readonly<Record<string, string | number | undefined>>
) =>
  Object.entries(query).flatMap(([key, value]) =>
    value === undefined ? [] : [[key, String(value)]]
  );

/**
 * The availability the booking pages read, without the date a range query
 * names none for or a summary an untitled calendar event lacks: the contract
 * omits both rather than send them empty.
 */
const toCustomerAvailability = ({
  date,
  notices,
  ...availability
}: WorkspaceAvailability): CustomerAvailability => ({
  ...availability,
  ...(date !== undefined && { date }),
  notices: notices.map(({ summary, ...notice }) => ({
    ...notice,
    ...(summary !== undefined && { summary }),
  })),
});

const toCustomerOffering = (
  offering: PublicOffering,
  {
    advertisedOn,
    overnightStayOffered,
  }: {
    readonly advertisedOn: Temporal.PlainDate;
    readonly overnightStayOffered: boolean;
  }
): CustomerOffering => {
  const copy = Struct.pick(offering, ["name", "description", "usage"]);
  const advertisedPrice = offering.advertisedPrice;
  const bookableDates = getBookableDates(offering.kind, advertisedOn);

  return Match.value(offering).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (cowork): CustomerOffering => ({
        family: "cowork",
        tier: cowork.tier,
        ...copy,
        summary: cowork.summary,
        price: cowork.price,
        advertisedPrice,
        bookableDates,
        addOns: cowork.addOns,
        ...(overnightStayOffered &&
          cowork.tier === overnightCoworkStayTier && {
            overnightStay: getOvernightStayTimes(),
          }),
      }),
      "meeting-room": (meetingRoom): CustomerOffering => ({
        family: "meeting-room",
        duration: getMeetingRoomReservationDurationKey(meetingRoom.duration),
        durationLabel: meetingRoom.durationLabel,
        ...copy,
        facts: meetingRoom.facts,
        price: meetingRoom.price,
        advertisedPrice,
        bookableDates,
      }),
      office: (office): CustomerOffering => ({
        family: "office",
        ...copy,
        price: office.price,
        seatPrice: office.seatPrice,
        ...(office.maximumSeats !== undefined && {
          maximumSeats: office.maximumSeats,
        }),
        maximumDurationHours: office.maximumDurationHours,
        advertisedPrice,
        bookableDates,
      }),
    })
  );
};
