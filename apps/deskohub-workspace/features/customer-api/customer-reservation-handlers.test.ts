import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Deferred, Effect, Layer, Option } from "effect";
import type {
  CustomerReservationHistory,
  CustomerReservationSummary,
} from "@/features/account";
import {
  testCustomerSession,
  testLinkedAccount,
} from "@/features/account/backend/account-operations.test-utils";
import {
  type PeekedStanding,
  peeking,
  testPeekedStandings,
} from "@/features/account/backend/current-customer-account.test-utils";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { CustomerReservationHistoryWithAccessService } from "@/features/account/backend/customer-reservation-history-with-access.service";
import {
  CustomerAccountAccessError,
  customerAccountUnavailable,
} from "@/features/account/customer-account";
import type { InvoicePdfFile } from "@/features/accounting/backend/invoice-pdf";
import { InvoicePdfRenderingError } from "@/features/accounting/backend/invoice-pdf";
import {
  ReservationInvoiceNotFoundError,
  ReservationInvoiceNotIssuedError,
  ReservationInvoicePdfService,
} from "@/features/accounting/backend/reservation-invoice-pdf.service";
import {
  CheckoutPaymentPageService,
  type PaymentPageReopening,
} from "@/features/checkout/backend/checkout/checkout-payment-page.service";
import {
  CheckoutPaymentRetryService,
  type PaymentRetryPreparation,
  PaymentRetryUnavailableError,
} from "@/features/checkout/backend/checkout/checkout-payment-retry.service";
import {
  CheckoutStatusService,
  type CheckoutStatusViewModel,
} from "@/features/checkout/backend/checkout/checkout-status.service";
import { buildSignedPayState } from "@/features/checkout/backend/checkout/pay-state";
import {
  getPayStateCheckoutView,
  type PayStateCheckoutView,
} from "@/features/checkout/backend/checkout/pay-state-checkout-view";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import {
  ReservationAccessService,
  type ReservationAccessViewModel,
} from "@/features/reservation/backend/reservation-access.service";
import {
  type ReservationAuthorizationInput,
  ReservationAuthorizationService,
  ReservationAuthorizationUnavailableError,
} from "@/features/reservation/backend/reservation-authorization.service";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  type ContractWithdrawal,
  WithdrawalRepository,
} from "@/features/withdrawal/backend/withdrawal.repository";
import { TestSealedStateKeys } from "@/shared/testing/sealed-state-keys.test-utils";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { instantStringSchema, type PlainDate } from "@/shared/utils/temporal";
import {
  workspaceFormattedAddress,
  workspaceGoogleDirectionsUrl,
  workspaceGoogleMapUrl,
} from "@/shared/utils/workspace-location-map";
import {
  type CustomerApiCall,
  customerApiRequest,
  makeCustomerApiTestServer,
  testCustomerEndpointGuards,
} from "./customer-api.test-utils";
import type { CustomerReservationServiceLayers } from "./customer-reservation-layers";

const orderId = workspaceReservationIdSchema.make(
  "019edbcf-5026-7ecc-821b-eda46998eaaa"
);

/**
 * Authorization that lets the session's own account see `orderId`, read
 * through the authentication the handler provides.
 */
const ownOrderAuthorization = (
  authorized: boolean
): CustomerReservationServiceLayers["authorization"] =>
  Layer.effect(
    ReservationAuthorizationService,
    Effect.map(CustomerAuthentication, (session) => {
      const isAuthorized = (input: ReservationAuthorizationInput) =>
        session.currentUser.pipe(
          Effect.map(
            (user) =>
              authorized &&
              input.orderId === orderId &&
              user?.accountId === testCustomerSession.accountId
          ),
          Effect.orElseSucceed(() => false)
        );
      return { isAuthorized, authorize: isAuthorized };
    })
  );

describe("listReservations", () => {
  const listReservations: CustomerApiCall = {
    method: "GET",
    path: "/reservations",
  };

  const ownReservation: CustomerReservationSummary = {
    id: orderId,
    workspaceReservationId: orderId,
    product: { kind: "cowork", tier: "open-space" },
    startsAt: "2099-07-01T06:00:00Z",
    endsAt: "2099-07-01T22:00:00Z",
    seats: 1,
    status: "confirmed",
  };
  const bookedForOther: CustomerReservationSummary = {
    id: "dotypos-2",
    party: { kind: "booked-for", customerName: "Grace Hopper" },
    product: { kind: "meeting-room" },
    startsAt: "2020-07-02T08:00:00Z",
    endsAt: "2020-07-02T10:00:00Z",
    setupStartsAt: "2020-07-02T07:45:00Z",
    seats: null,
    status: "cancelled",
  };
  const undated: CustomerReservationSummary = {
    id: "dotypos-3",
    reviewSandbox: true,
    product: { kind: "other" },
    startsAt: null,
    endsAt: null,
    seats: null,
    status: "requires-attention",
  };

  const historyServices = (
    options: {
      /** The session's standing; linked to `testLinkedAccount` unless given. */
      readonly standing?: PeekedStanding;
      readonly history?: Effect.Effect<
        CustomerReservationHistory,
        CustomerAccountAccessError
      >;
    } = {}
  ) => {
    const load = mock(
      () =>
        options.history ??
        Effect.succeed<CustomerReservationHistory>({
          kind: "available",
          groups: {
            current: [ownReservation],
            past: [bookedForOther],
            unavailable: [undated],
          },
        })
    );
    const reservations: Partial<CustomerReservationServiceLayers> = {
      currentAccount: peeking(options.standing ?? testPeekedStandings.linked),
      history: () =>
        Layer.mock(CustomerReservationHistoryWithAccessService, { load }),
    };
    return { load, reservations };
  };

  testCustomerEndpointGuards(listReservations);

  test("lists the linked account's history as the account page groups it", async () => {
    const { load, reservations } = historyServices();
    const api = makeCustomerApiTestServer({ reservations });

    const response = await api.handle(customerApiRequest(listReservations));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      current: [
        {
          id: orderId,
          orderId,
          product: { kind: "cowork", tier: "open-space", stay: "day" },
          startsAt: "2099-07-01T06:00:00Z",
          endsAt: "2099-07-01T22:00:00Z",
          seats: 1,
          status: "confirmed",
        },
      ],
      past: [
        {
          id: "dotypos-2",
          party: { kind: "booked-for", customerName: "Grace Hopper" },
          product: { kind: "meeting-room" },
          startsAt: "2020-07-02T08:00:00Z",
          endsAt: "2020-07-02T10:00:00Z",
          setupStartsAt: "2020-07-02T07:45:00Z",
          seats: null,
          status: "cancelled",
        },
      ],
      unavailable: [
        {
          id: "dotypos-3",
          reviewSandbox: true,
          product: { kind: "other" },
          startsAt: null,
          endsAt: null,
          seats: null,
          status: "requires-attention",
        },
      ],
    });
    // Names included, as the account page shows them, in the default locale.
    expect(load).toHaveBeenCalledWith(testLinkedAccount, { locale: "en-US" });
  });

  test("tells an overnight Reserved Desk stay from a day by its booked time", async () => {
    const reservedDesk = { kind: "cowork", tier: "reserved-desk" } as const;
    const { reservations } = historyServices({
      history: Effect.succeed({
        kind: "available",
        groups: {
          current: [
            {
              ...ownReservation,
              product: reservedDesk,
              startsAt: "2099-07-01T10:00:00Z",
              endsAt: "2099-07-02T10:00:00Z",
              bookedSelection: {
                selection: {
                  family: "cowork",
                  date: "2099-07-01" as PlainDate,
                  tier: "reserved-desk",
                  stay: "overnight",
                },
              },
            },
            {
              ...ownReservation,
              id: "dotypos-day",
              product: reservedDesk,
              startsAt: "2099-06-30T22:00:00Z",
              endsAt: "2099-07-01T22:00:00Z",
            },
          ],
          past: [],
          unavailable: [
            { ...undated, product: reservedDesk },
            {
              ...undated,
              id: "dotypos-unreadable",
              product: reservedDesk,
              startsAt: "2099-07-01T10:00:00Z",
              endsAt: "not-a-date",
            },
          ],
        },
      }),
    });
    const api = makeCustomerApiTestServer({ reservations });

    const response = await api.handle(customerApiRequest(listReservations));
    const history = (await response.json()) as {
      readonly current: readonly {
        readonly product: unknown;
        readonly bookedSelection?: { readonly selection: unknown };
      }[];
      readonly unavailable: readonly { readonly product: unknown }[];
    };

    expect(history.current.map(({ product }) => product)).toEqual([
      { ...reservedDesk, stay: "overnight" },
      { ...reservedDesk, stay: "day" },
    ]);
    // Booking it again books the same stay.
    expect(history.current[0]?.bookedSelection?.selection).toMatchObject({
      tier: "reserved-desk",
      stay: "overnight",
    });
    // Without a readable time, no stay is told.
    expect(history.unavailable.map(({ product }) => product)).toEqual([
      reservedDesk,
      reservedDesk,
    ]);
  });

  test("lists only the reservations an account without a Dotypos customer authored", async () => {
    const { load, reservations } = historyServices({
      standing: testPeekedStandings.unlinked,
    });
    const api = makeCustomerApiTestServer({ reservations });

    const response = await api.handle(customerApiRequest(listReservations));

    expect(response.status).toBe(200);
    expect(load).toHaveBeenCalledWith(
      { accountId: testCustomerSession.accountId },
      { locale: "en-US" }
    );
  });

  test("carries each booking's name, access window, booked selection and today's door code", async () => {
    const { reservations } = historyServices({
      history: Effect.succeed({
        kind: "available",
        groups: {
          current: [
            {
              ...ownReservation,
              productName: "Open Space",
              accessStartsAt: "2099-07-01T06:00:00.000Z",
              accessEndsAt: "2099-07-01T22:00:00.000Z",
              bookedSelection: {
                selection: {
                  family: "cowork",
                  date: "2099-07-01" as PlainDate,
                  tier: "open-space",
                  coffee: true,
                },
              },
              todayAccess: {
                code: "fixture-access",
                accessStartsAt: "2099-07-01T06:00:00.000Z",
                accessEndsAt: "2099-07-01T22:00:00.000Z",
              },
            },
            {
              ...bookedForOther,
              id: "meeting-room-order",
              productName: "Meeting room",
              bookedSelection: {
                selection: {
                  family: "meeting-room",
                  date: "2099-07-02" as PlainDate,
                  startTime: "09:00",
                  duration: "hour:1",
                },
                earlySetup: true,
              },
            },
          ],
          past: [],
          unavailable: [],
        },
      }),
    });
    const api = makeCustomerApiTestServer({ reservations });

    const response = await api.handle(customerApiRequest(listReservations));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.current[0]).toEqual({
      id: orderId,
      orderId,
      product: { kind: "cowork", tier: "open-space", stay: "day" },
      productName: "Open Space",
      startsAt: "2099-07-01T06:00:00Z",
      endsAt: "2099-07-01T22:00:00Z",
      seats: 1,
      status: "confirmed",
      accessStartsAt: "2099-07-01T06:00:00.000Z",
      accessEndsAt: "2099-07-01T22:00:00.000Z",
      bookedSelection: {
        selection: {
          family: "cowork",
          date: "2099-07-01",
          tier: "open-space",
          coffee: true,
        },
      },
      todayAccess: {
        code: "fixture-access",
        accessStartsAt: "2099-07-01T06:00:00.000Z",
        accessEndsAt: "2099-07-01T22:00:00.000Z",
      },
    });
    expect(body.current[1]).toMatchObject({
      productName: "Meeting room",
      bookedSelection: {
        selection: {
          family: "meeting-room",
          date: "2099-07-02",
          startTime: "09:00",
          duration: "hour:1",
        },
        earlySetup: true,
      },
    });
    expect(body.current[1]).not.toHaveProperty("todayAccess");
  });

  test("names the products in the locale the client asks for", async () => {
    const { load, reservations } = historyServices();
    const api = makeCustomerApiTestServer({ reservations });

    const response = await api.handle(
      customerApiRequest({
        ...listReservations,
        path: "/reservations?locale=cs-CZ",
      })
    );

    expect(response.status).toBe(200);
    expect(load).toHaveBeenCalledWith(testLinkedAccount, { locale: "cs-CZ" });
  });

  test("refuses a locale the site doesn't offer", async () => {
    const { load, reservations } = historyServices();
    const api = makeCustomerApiTestServer({ reservations });

    const response = await api.handle(
      customerApiRequest({
        ...listReservations,
        path: "/reservations?locale=xx-XX",
      })
    );

    expect(response.status).toBe(400);
    expect(load).not.toHaveBeenCalled();
  });

  test("builds the history's door codes from the authorization of the session's account", async () => {
    // The history sees the session's own order only through the
    // authorization the handler hands it.
    const history = mock(
      (
        authorization: Parameters<
          CustomerReservationServiceLayers["history"]
        >[0]
      ) =>
        Layer.effect(
          CustomerReservationHistoryWithAccessService,
          Effect.map(ReservationAuthorizationService, (authorizations) => ({
            load: () =>
              authorizations
                .isAuthorized({
                  orderId,
                  locale: "en-US",
                  permission: "view-access-code",
                })
                .pipe(
                  Effect.map(
                    (authorized): CustomerReservationHistory => ({
                      kind: "available",
                      groups: {
                        current: authorized ? [ownReservation] : [],
                        past: [],
                        unavailable: [],
                      },
                    })
                  )
                ),
          }))
        ).pipe(Layer.provide(authorization))
    );
    const api = makeCustomerApiTestServer({
      reservations: {
        currentAccount: peeking(testPeekedStandings.linked),
        authorization: ownOrderAuthorization(true),
        history,
      },
    });

    const response = await api.handle(customerApiRequest(listReservations));

    expect(response.status).toBe(200);
    expect(history).toHaveBeenCalledTimes(1);
    expect((await response.json()).current).toHaveLength(1);
  });

  test("tells an account whose deletion is pending why it has no history", async () => {
    const { reservations } = historyServices({
      history: Effect.fail(
        new CustomerAccountAccessError({
          reason: "link-required",
          linkReason: "deletion-requested",
        })
      ),
    });
    const api = makeCustomerApiTestServer({ reservations });

    const response = await api.handle(customerApiRequest(listReservations));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      _tag: "CustomerAccountLinkRequired",
      reason: "deletion-pending",
    });
  });

  test("answers unavailable when the account's link can't be read", async () => {
    const { load, reservations } = historyServices({
      standing: testPeekedStandings["link unavailable"],
    });
    const api = makeCustomerApiTestServer({ reservations });

    const response = await api.handle(customerApiRequest(listReservations));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
    expect(load).not.toHaveBeenCalled();
  });

  test("answers unavailable when Dotypos can't serve the history", async () => {
    const { reservations } = historyServices({
      history: Effect.succeed({
        kind: "unavailable",
        reason: "provider-unavailable",
      }),
    });
    const api = makeCustomerApiTestServer({ reservations });

    const response = await api.handle(customerApiRequest(listReservations));

    expect(response.status).toBe(503);
  });
});

describe("getReservationStatus", () => {
  const getReservationStatus: CustomerApiCall = {
    method: "GET",
    path: `/reservations/${orderId}/status`,
  };

  const fulfilledOrder = {
    orderId,
    returnOutcome: "unknown",
    kind: "meeting-room",
    status: "fulfilled",
    paymentStatus: "paid",
    fulfillmentStatus: "fulfilled",
    summary: {
      kind: "meeting-room",
      price: { value: 35_000, exponent: 2, currency: "CZK" },
      reservedFrom: Temporal.Instant.from("2026-06-20T08:15:00Z"),
      reservedUntil: Temporal.Instant.from("2026-06-20T10:00:00Z"),
      setupFrom: Temporal.Instant.from("2026-06-20T08:00:00Z"),
    },
  } as CheckoutStatusViewModel;

  const statusServices = (
    refreshStatus: CheckoutStatusService["Service"]["refreshStatus"],
    options: {
      readonly authorized?: boolean;
      readonly getStatus?: CheckoutStatusService["Service"]["getStatus"];
      readonly findWithdrawal?: WithdrawalRepository["Service"]["findByContract"];
    } = {}
  ): Partial<CustomerReservationServiceLayers> => ({
    authorization: ownOrderAuthorization(options.authorized ?? true),
    checkoutStatus: Layer.mock(CheckoutStatusService, {
      refreshStatus,
      getStatus:
        options.getStatus ?? (() => Effect.die("must not read local status")),
    }),
    ...(options.findWithdrawal && {
      withdrawalRecords: Layer.mock(WithdrawalRepository, {
        findByContract: options.findWithdrawal,
      }),
    }),
  });

  const withdrawal = {
    submittedAt: Temporal.Instant.from("2026-06-19T14:30:00Z"),
    refundAmount: { value: 35_000, exponent: 2, currency: "CZK" },
  } as ContractWithdrawal;

  testCustomerEndpointGuards(getReservationStatus);

  test("answers the refreshed status of the account's own order", async () => {
    const refreshStatus = mock(() => Effect.succeed(fulfilledOrder));
    const api = makeCustomerApiTestServer({
      reservations: statusServices(refreshStatus),
    });

    const response = await api.handle(customerApiRequest(getReservationStatus));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      orderId,
      kind: "meeting-room",
      status: "fulfilled",
      paymentStatus: "paid",
      fulfillmentStatus: "fulfilled",
      startsAt: "2026-06-20T08:15:00Z",
      endsAt: "2026-06-20T10:00:00Z",
      setupStartsAt: "2026-06-20T08:00:00Z",
      total: { value: 35_000, exponent: 2, currency: "CZK" },
    });
    expect(refreshStatus).toHaveBeenCalledWith({
      orderId,
      returnOutcome: "unknown",
    });
  });

  test("answers the order's booked selection beside its status", async () => {
    const refreshStatus = mock(() =>
      Effect.succeed({
        ...fulfilledOrder,
        bookedSelection: {
          selection: {
            family: "meeting-room",
            date: "2026-06-20" as PlainDate,
            startTime: "10:15",
            duration: "hour:1",
          },
          earlySetup: true,
        },
      } as CheckoutStatusViewModel)
    );
    const api = makeCustomerApiTestServer({
      reservations: statusServices(refreshStatus),
    });

    const response = await api.handle(customerApiRequest(getReservationStatus));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      bookedSelection: {
        selection: {
          family: "meeting-room",
          date: "2026-06-20",
          startTime: "10:15",
          duration: "hour:1",
        },
        earlySetup: true,
      },
    });
  });

  test("answers an order that isn't paid yet with its status alone", async () => {
    const api = makeCustomerApiTestServer({
      reservations: statusServices(() =>
        Effect.succeed({
          orderId,
          returnOutcome: "unknown",
          kind: "cowork",
          status: "created",
          paymentStatus: "pending",
          fulfillmentStatus: "not_started",
        } as CheckoutStatusViewModel)
      ),
    });

    const response = await api.handle(customerApiRequest(getReservationStatus));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      orderId,
      kind: "cowork",
      status: "created",
      paymentStatus: "pending",
      fulfillmentStatus: "not_started",
    });
  });

  test("marks a pending order whose payment page can be opened again", async () => {
    const pendingOrder = {
      orderId,
      returnOutcome: "unknown",
      kind: "cowork",
      status: "pending",
      paymentStatus: "pending",
      fulfillmentStatus: "not_started",
    } as CheckoutStatusViewModel;
    const answer = async (state: CheckoutStatusViewModel) => {
      const api = makeCustomerApiTestServer({
        reservations: statusServices(() => Effect.succeed(state)),
      });
      const response = await api.handle(
        customerApiRequest(getReservationStatus)
      );
      expect(response.status).toBe(200);
      return response.json();
    };

    expect(
      await answer({
        ...pendingOrder,
        paymentPageReopenable: true,
      } as CheckoutStatusViewModel)
    ).toMatchObject({ status: "pending", paymentPageReopenable: true });
    expect(await answer(pendingOrder)).not.toHaveProperty(
      "paymentPageReopenable"
    );
  });

  test("answers a withdrawn order with when the customer withdrew and the refund", async () => {
    const findWithdrawal = mock(() => Effect.succeed(Option.some(withdrawal)));
    const api = makeCustomerApiTestServer({
      reservations: statusServices(
        () => Effect.succeed({ ...fulfilledOrder, status: "cancelled" }),
        { findWithdrawal }
      ),
    });

    const response = await api.handle(customerApiRequest(getReservationStatus));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      orderId,
      status: "cancelled",
      withdrawal: {
        submittedAt: "2026-06-19T14:30:00Z",
        refundAmount: { value: 35_000, exponent: 2, currency: "CZK" },
      },
    });
    expect(findWithdrawal).toHaveBeenCalledWith({
      kind: "reservation",
      id: orderId,
    });
  });

  test("reads the withdrawal beside the status, not after it", async () => {
    const withdrawalRead = Deferred.makeUnsafe<void>();
    const api = makeCustomerApiTestServer({
      reservations: statusServices(
        // The refresh answers only once the withdrawal read has started.
        () => Effect.as(Deferred.await(withdrawalRead), fulfilledOrder),
        {
          findWithdrawal: () =>
            Effect.as(
              Deferred.succeed(withdrawalRead, undefined),
              Option.none()
            ),
        }
      ),
    });

    const response = await api.handle(customerApiRequest(getReservationStatus));

    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty("withdrawal");
  });

  test("answers someone else's withdrawn order as not found", async () => {
    const api = makeCustomerApiTestServer({
      reservations: statusServices(() => Effect.succeed(fulfilledOrder), {
        authorized: false,
        findWithdrawal: () => Effect.succeed(Option.some(withdrawal)),
      }),
    });

    const response = await api.handle(customerApiRequest(getReservationStatus));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      _tag: "CustomerReservationNotFound",
    });
  });

  test("answers someone else's order as not found, without reading it", async () => {
    const refreshStatus = mock(() => Effect.succeed(fulfilledOrder));
    const api = makeCustomerApiTestServer({
      reservations: statusServices(refreshStatus, { authorized: false }),
    });

    const response = await api.handle(customerApiRequest(getReservationStatus));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      _tag: "CustomerReservationNotFound",
    });
    expect(refreshStatus).not.toHaveBeenCalled();
  });

  test("answers the local status when the refresh fails", async () => {
    const api = makeCustomerApiTestServer({
      reservations: statusServices(
        () => Effect.fail(new Error("refresh failed") as never),
        { getStatus: () => Effect.succeed(fulfilledOrder) }
      ),
    });

    const response = await api.handle(customerApiRequest(getReservationStatus));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "fulfilled" });
  });

  test("answers unavailable when no status can be read", async () => {
    const api = makeCustomerApiTestServer({
      reservations: statusServices(
        () => Effect.fail(new Error("refresh failed") as never),
        { getStatus: () => Effect.fail(new Error("read failed") as never) }
      ),
    });

    const response = await api.handle(customerApiRequest(getReservationStatus));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
  });

  test("finishes a refresh after its client disconnects", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const refreshes: string[] = [];
    const api = makeCustomerApiTestServer({
      reservations: statusServices(() =>
        Effect.sync(() => started.resolve()).pipe(
          Effect.andThen(Effect.promise(() => release.promise)),
          Effect.andThen(
            Effect.sync(() => {
              refreshes.push("finished");
              return fulfilledOrder;
            })
          )
        )
      ),
    });
    const client = new AbortController();

    const response = api.handle(
      customerApiRequest({ ...getReservationStatus, signal: client.signal })
    );
    await started.promise;
    client.abort();
    await Bun.sleep(10);
    expect(refreshes).toEqual([]);
    release.resolve();
    await response.catch(() => undefined);

    expect(refreshes).toEqual(["finished"]);
  });
});

describe("reopenPaymentPage", () => {
  const reopenPaymentPage: CustomerApiCall = {
    method: "POST",
    path: `/reservations/${orderId}/payment-page`,
    body: {},
  };

  const paymentPageServices = (
    reopen: CheckoutPaymentPageService["Service"]["reopen"]
  ): Partial<CustomerReservationServiceLayers> => ({
    authorization: ownOrderAuthorization(true),
    paymentPage: () => Layer.mock(CheckoutPaymentPageService, { reopen }),
  });

  const answering = (reopening: PaymentPageReopening) =>
    paymentPageServices(() => Effect.succeed(reopening));

  testCustomerEndpointGuards(reopenPaymentPage);

  test("answers the payment page the order's unpaid payment opened", async () => {
    const reopen = mock(() =>
      Effect.succeed<PaymentPageReopening>({
        state: "opened",
        providerRedirectUrl: "https://sandbox.example/hpp/order-page",
      })
    );
    const api = makeCustomerApiTestServer({
      reservations: paymentPageServices(reopen),
    });

    const response = await api.handle(customerApiRequest(reopenPaymentPage));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: "https://sandbox.example/hpp/order-page",
    });
    // The session alone authorizes it: no access cookie or link token.
    expect(reopen).toHaveBeenCalledWith({ orderId, locale: "en-US" });
  });

  test("returns the reopened page's payment where the app asks", async () => {
    const reopen = mock(() =>
      Effect.succeed<PaymentPageReopening>({ state: "not_found" })
    );
    const api = makeCustomerApiTestServer({
      reservations: paymentPageServices(reopen),
    });

    await api.handle(
      customerApiRequest({
        ...reopenPaymentPage,
        body: { returnTarget: "native-app" },
      })
    );

    expect(reopen).toHaveBeenCalledWith({
      orderId,
      locale: "en-US",
      returnTarget: "native-app",
    });
  });

  test("hands the payment page service the authorization read through the session", async () => {
    const authorizations: boolean[] = [];
    const api = makeCustomerApiTestServer({
      reservations: {
        authorization: ownOrderAuthorization(true),
        paymentPage: (authorization) =>
          Layer.effect(
            CheckoutPaymentPageService,
            Effect.map(ReservationAuthorizationService, (authorizer) => ({
              reopen: (input) =>
                authorizer
                  .isAuthorized({ ...input, permission: "open-payment-page" })
                  .pipe(
                    Effect.tap((authorized) =>
                      Effect.sync(() => authorizations.push(authorized))
                    ),
                    Effect.as<PaymentPageReopening>({ state: "not_found" })
                  ),
            }))
          ).pipe(Layer.provide(authorization)),
      },
    });

    await api.handle(customerApiRequest(reopenPaymentPage));

    expect(authorizations).toEqual([true]);
  });

  test("answers someone else's order, or one that doesn't exist, as not found", async () => {
    const api = makeCustomerApiTestServer({
      reservations: answering({ state: "not_found" }),
    });

    const response = await api.handle(customerApiRequest(reopenPaymentPage));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      _tag: "CustomerReservationNotFound",
    });
  });

  test.each([
    "paid",
    "late_payment",
    "released",
    "no_active_attempt",
    "window_elapsed",
  ] as const)(
    "answers an order whose page closed as %s with that reason",
    async (reason) => {
      const api = makeCustomerApiTestServer({
        reservations: answering({ state: "closed", reason }),
      });

      const response = await api.handle(customerApiRequest(reopenPaymentPage));

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        _tag: "CustomerPaymentPageClosed",
        reason,
      });
    }
  );

  test("answers unavailable when the order can't be read", async () => {
    const api = makeCustomerApiTestServer({
      reservations: paymentPageServices(() =>
        Effect.fail(new Error("read failed") as never)
      ),
    });

    const response = await api.handle(customerApiRequest(reopenPaymentPage));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
  });
});

describe("retryPayment", () => {
  const retryPayment: CustomerApiCall = {
    method: "POST",
    path: `/reservations/${orderId}/payment-retry`,
    body: { locale: "cs-CZ" },
  };

  const retryReservation = {
    kind: "cowork" as const,
    entryTier: "basic" as const,
    coffee: false,
    date: "2026-08-04",
    name: "Ada Lovelace",
    email: testEmailAddress("ada"),
    phone: "+420777000111",
  };

  /** The checkout view of an order-bound Pay state, as a retry issues it. */
  const retryCheckout = async (
    changedKeys?: PayStateCheckoutView["changedKeys"]
  ) => {
    const state = await Effect.runPromise(
      buildSignedPayState({
        locale: "cs-CZ",
        reservation: retryReservation,
        quote: buildCoworkReservationQuote(retryReservation),
        orderId,
        bookedAt: instantStringSchema.make("2026-07-01T10:00:00.000Z"),
        holdExpiresAt: instantStringSchema.make("2026-07-01T10:10:00.000Z"),
        binding: "order",
        retriedAttemptId: paymentAttemptIdSchema.make("retried-attempt"),
        changedKeys,
      }).pipe(Effect.provide(TestSealedStateKeys))
    );
    return getPayStateCheckoutView(
      state,
      Temporal.Instant.from("2026-07-01T10:00:00Z")
    );
  };

  const paymentRetryServices = (
    prepare: CheckoutPaymentRetryService["Service"]["prepare"]
  ): Partial<CustomerReservationServiceLayers> => ({
    authorization: ownOrderAuthorization(true),
    paymentRetry: () => Layer.mock(CheckoutPaymentRetryService, { prepare }),
  });

  const answering = (preparation: PaymentRetryPreparation) =>
    paymentRetryServices(() => Effect.succeed(preparation));

  const ready = async (
    changedKeys?: PayStateCheckoutView["changedKeys"]
  ): Promise<PaymentRetryPreparation> => {
    const checkout = await retryCheckout(changedKeys);
    return {
      state: "ready",
      payState: {
        freshPayUrl: "/cs-CZ/checkout/pay?orderId=x",
        freshPayStateToken: "retry-pay-state-token",
        expiresAt: checkout.expiresAt,
      },
      checkout,
    };
  };

  testCustomerEndpointGuards(retryPayment);

  test("answers the same order's checkout to pay again, in the app's locale", async () => {
    const preparation = await ready();
    const prepare = mock(() => Effect.succeed(preparation));
    const api = makeCustomerApiTestServer({
      reservations: paymentRetryServices(prepare),
    });

    const response = await api.handle(customerApiRequest(retryPayment));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ready",
      orderId,
      payStateToken: "retry-pay-state-token",
    });
    // The session alone authorizes it: no access cookie or link token.
    expect(prepare).toHaveBeenCalledWith({ orderId, locale: "cs-CZ" });
  });

  test("answers a changed price as a price review to accept first", async () => {
    const api = makeCustomerApiTestServer({
      reservations: answering(
        await ready({ sectionKeys: ["total"], itemKeys: [] })
      ),
    });

    const response = await api.handle(customerApiRequest(retryPayment));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "price_review",
      priceReview: { changedKeys: { sectionKeys: ["total"], itemKeys: [] } },
    });
  });

  test("answers someone else's order, or one that doesn't exist, as not found", async () => {
    const api = makeCustomerApiTestServer({
      reservations: answering({ state: "not_found" }),
    });

    const response = await api.handle(customerApiRequest(retryPayment));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      _tag: "CustomerReservationNotFound",
    });
  });

  test.each([
    [{ state: "not_retryable", reason: "paid" }, "paid"],
    [
      { state: "not_retryable", reason: "payment_in_progress" },
      "payment_in_progress",
    ],
    [{ state: "not_retryable", reason: "late_payment" }, "late_payment"],
    [{ state: "not_retryable", reason: "superseded" }, "superseded"],
    [
      { state: "not_retryable", reason: "reservation_cancelled" },
      "reservation_cancelled",
    ],
    [
      { state: "not_retryable", reason: "reservation_ended" },
      "reservation_ended",
    ],
    [
      { state: "not_retryable", reason: "details_unavailable" },
      "details_unavailable",
    ],
    [{ state: "not_retryable", reason: "needs_review" }, "needs_review"],
    [{ state: "spot_unavailable" }, "spot_unavailable"],
    [{ state: "payment_settling" }, "payment_settling"],
  ] as const)(
    "answers a refused retry with its reason (%o)",
    async (preparation, reason) => {
      const api = makeCustomerApiTestServer({
        reservations: answering(preparation),
      });

      const response = await api.handle(customerApiRequest(retryPayment));

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        _tag: "CustomerPaymentRetryRefused",
        reason,
      });
    }
  );

  test("answers unavailable when the retry can't be prepared now", async () => {
    const api = makeCustomerApiTestServer({
      reservations: paymentRetryServices(() =>
        Effect.fail(
          new PaymentRetryUnavailableError({ message: "provider down" })
        )
      ),
    });

    const response = await api.handle(customerApiRequest(retryPayment));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
  });
});

describe("getReservationAccess", () => {
  const getReservationAccess: CustomerApiCall = {
    method: "GET",
    path: `/reservations/${orderId}/access`,
  };

  const accessServices = (
    getAccess: ReservationAccessService["Service"]["getAccess"]
  ): Partial<CustomerReservationServiceLayers> => ({
    authorization: ownOrderAuthorization(true),
    access: () => Layer.mock(ReservationAccessService, { getAccess }),
  });

  const answering = (access: ReservationAccessViewModel) =>
    accessServices(() => Effect.succeed(access));

  testCustomerEndpointGuards(getReservationAccess);

  test("answers the door code of the account's own order, and when the lock accepts it", async () => {
    const getAccess = mock(() =>
      Effect.succeed<ReservationAccessViewModel>({
        state: "available",
        code: "2468",
        accessStartsAt: Temporal.Instant.from("2026-06-20T08:00:00Z"),
        accessEndsAt: Temporal.Instant.from("2026-06-20T11:00:00Z"),
      })
    );
    const api = makeCustomerApiTestServer({
      reservations: accessServices(getAccess),
    });

    const response = await api.handle(customerApiRequest(getReservationAccess));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: "2468",
      accessStartsAt: "2026-06-20T08:00:00Z",
      accessEndsAt: "2026-06-20T11:00:00Z",
    });
    // The session alone authorizes it: no access cookie or link token.
    expect(getAccess).toHaveBeenCalledWith({ orderId, locale: "en-US" });
  });

  test("hands the code service the authorization read through the session", async () => {
    const authorizations: boolean[] = [];
    const api = makeCustomerApiTestServer({
      reservations: {
        authorization: ownOrderAuthorization(true),
        access: (authorization) =>
          Layer.effect(
            ReservationAccessService,
            Effect.map(ReservationAuthorizationService, (authorizer) => ({
              getAccess: (input) =>
                authorizer
                  .isAuthorized({ ...input, permission: "view-access-code" })
                  .pipe(
                    Effect.tap((authorized) =>
                      Effect.sync(() => authorizations.push(authorized))
                    ),
                    Effect.as<ReservationAccessViewModel>({
                      state: "invalid_link",
                    })
                  ),
            }))
          ).pipe(Layer.provide(authorization)),
      },
    });

    await api.handle(customerApiRequest(getReservationAccess));

    expect(authorizations).toEqual([true]);
  });

  test("answers someone else's order as not found", async () => {
    const api = makeCustomerApiTestServer({
      reservations: answering({ state: "invalid_link" }),
    });

    const response = await api.handle(customerApiRequest(getReservationAccess));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      _tag: "CustomerReservationNotFound",
    });
  });

  test("answers an order that isn't fulfilled yet as without a code", async () => {
    const api = makeCustomerApiTestServer({
      reservations: answering({
        state: "unavailable",
        reason: "reservation-state",
      }),
    });

    const response = await api.handle(customerApiRequest(getReservationAccess));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      _tag: "CustomerAccessCodeUnavailable",
    });
  });

  test("answers unavailable when the code couldn't be looked up", async () => {
    const api = makeCustomerApiTestServer({
      reservations: answering({
        state: "unavailable",
        reason: "lookup-failed",
      }),
    });

    const response = await api.handle(customerApiRequest(getReservationAccess));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
  });

  test("finishes issuing a code after its client disconnects", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const issued: string[] = [];
    const api = makeCustomerApiTestServer({
      reservations: accessServices(() =>
        Effect.sync(() => started.resolve()).pipe(
          Effect.andThen(Effect.promise(() => release.promise)),
          Effect.andThen(
            Effect.sync((): ReservationAccessViewModel => {
              issued.push("issued");
              return { state: "invalid_link" };
            })
          )
        )
      ),
    });
    const client = new AbortController();

    const response = api.handle(
      customerApiRequest({ ...getReservationAccess, signal: client.signal })
    );
    await started.promise;
    client.abort();
    await Bun.sleep(10);
    expect(issued).toEqual([]);
    release.resolve();
    await response.catch(() => undefined);

    expect(issued).toEqual(["issued"]);
  });
});

describe("getReservationInvoice", () => {
  const getReservationInvoice: CustomerApiCall = {
    method: "GET",
    path: `/reservations/${orderId}/invoice`,
  };

  const issuedInvoice: InvoicePdfFile = {
    bytes: new TextEncoder().encode("%PDF-1.7\n%%EOF\n"),
    fileName: "WS-FV-2026-000042.pdf",
  };

  const invoiceServices = (
    getPdf: ReservationInvoicePdfService["Service"]["getPdf"]
  ): Partial<CustomerReservationServiceLayers> => ({
    authorization: ownOrderAuthorization(true),
    invoice: () => Layer.mock(ReservationInvoicePdfService, { getPdf }),
  });

  const failingWith = (
    failure: Effect.Error<
      ReturnType<ReservationInvoicePdfService["Service"]["getPdf"]>
    >
  ) => invoiceServices(() => Effect.fail(failure));

  testCustomerEndpointGuards(getReservationInvoice);

  test("downloads the issued invoice of the account's order as a PDF named by its number", async () => {
    const getPdf = mock(() => Effect.succeed(issuedInvoice));
    const api = makeCustomerApiTestServer({
      reservations: invoiceServices(getPdf),
    });

    const response = await api.handle(
      customerApiRequest(getReservationInvoice)
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="WS-FV-2026-000042.pdf"'
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(body.subarray(0, 5))).toBe("%PDF-");
    expect(body).toEqual(issuedInvoice.bytes);
    // The session alone authorizes it: no access cookie or link token.
    expect(getPdf).toHaveBeenCalledWith({ orderId, locale: "en-US" });
  });

  test("hands the invoice service the authorization read through the session", async () => {
    const authorizations: boolean[] = [];
    const api = makeCustomerApiTestServer({
      reservations: {
        authorization: ownOrderAuthorization(true),
        invoice: (authorization) =>
          Layer.effect(
            ReservationInvoicePdfService,
            Effect.map(ReservationAuthorizationService, (authorizer) => ({
              getPdf: (input) =>
                authorizer
                  .authorize({ ...input, permission: "view-invoice" })
                  .pipe(
                    Effect.tap((authorized) =>
                      Effect.sync(() => authorizations.push(authorized))
                    ),
                    Effect.andThen(
                      Effect.fail(
                        new ReservationInvoiceNotFoundError({ orderId })
                      )
                    )
                  ),
            }))
          ).pipe(Layer.provide(authorization)),
      },
    });

    await api.handle(customerApiRequest(getReservationInvoice));

    expect(authorizations).toEqual([true]);
  });

  test("answers someone else's order, or one that doesn't exist, as not found", async () => {
    const api = makeCustomerApiTestServer({
      reservations: failingWith(
        new ReservationInvoiceNotFoundError({ orderId })
      ),
    });

    const response = await api.handle(
      customerApiRequest(getReservationInvoice)
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      _tag: "CustomerReservationNotFound",
    });
  });

  test("answers an order without an issued invoice, such as one not fulfilled yet, as not issued", async () => {
    const api = makeCustomerApiTestServer({
      reservations: failingWith(
        new ReservationInvoiceNotIssuedError({ orderId })
      ),
    });

    const response = await api.handle(
      customerApiRequest(getReservationInvoice)
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      _tag: "CustomerInvoiceNotIssued",
    });
  });

  test.each([
    [
      "whether the account may see the order can't be read",
      new ReservationAuthorizationUnavailableError({
        orderId,
        cause: customerAccountUnavailable("account-link.read"),
      }),
    ],
    [
      "the stored invoice can't be rendered",
      new InvoicePdfRenderingError({ message: "renderer failed" }),
    ],
  ])("answers unavailable when %s", async (_case, failure) => {
    const api = makeCustomerApiTestServer({
      reservations: failingWith(failure),
    });

    const response = await api.handle(
      customerApiRequest(getReservationInvoice)
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
  });
});

describe("getEstablishment", () => {
  const getEstablishment: CustomerApiCall = {
    method: "GET",
    path: "/reservations/establishment",
  };

  testCustomerEndpointGuards(getEstablishment);

  test("answers where the space is from the site's location", async () => {
    const api = makeCustomerApiTestServer();

    const response = await api.handle(customerApiRequest(getEstablishment));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      name: workspaceSiteConstants.brand.name,
      formattedAddress: workspaceFormattedAddress,
      address: workspaceSiteConstants.location.address,
      coordinates: workspaceSiteConstants.location.coordinates,
      directionsUrl: workspaceGoogleDirectionsUrl,
      mapUrl: workspaceGoogleMapUrl,
    });
  });
});
