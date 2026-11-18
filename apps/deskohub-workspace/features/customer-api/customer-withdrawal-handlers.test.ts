import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import {
  WithdrawalNameRequiredError,
  WithdrawalRefusedError,
  WithdrawalService,
} from "@/features/withdrawal/backend/withdrawal.service";
import { WithdrawalReleaseGate } from "@/features/withdrawal/backend/withdrawal-release-gate";
import type { WithdrawalId } from "@/features/withdrawal/withdrawal-identifiers";
import type {
  WithdrawalQuote,
  WithdrawalReceipt,
} from "@/features/withdrawal/withdrawal-read-model";
import {
  type CustomerApiCall,
  customerApiRequest,
  makeCustomerApiTestServer,
  testCustomerEndpointGuards,
} from "./customer-api.test-utils";

const quoteCall: CustomerApiCall = {
  method: "GET",
  path: "/reservations/reservation-1/withdrawal?locale=en-US",
};
const withdrawCall: CustomerApiCall = {
  method: "POST",
  path: "/reservations/reservation-1/withdrawal",
  body: { locale: "en-US" },
};

const paid = { value: 300_000, exponent: 2, currency: "CZK" };
const quote: WithdrawalQuote = {
  contractId: "reservation-1",
  contractLabel: "Office · Jan 10 – 12, 2027",
  customerName: "Alex Example",
  receiptEmail: "customer@example.test",
  paidAmount: paid,
  refundAmount: { ...paid, value: 200_000 },
  refundBasis: { kind: "partial", unit: "day", unstarted: 2, total: 3 },
  periodEndsAt: Temporal.Instant.from("2027-01-16T23:00:00Z"),
};
const receipt: WithdrawalReceipt = {
  withdrawalId: "withdrawal-1" as WithdrawalId,
  submittedAt: Temporal.Instant.from("2027-01-10T08:00:00Z"),
  refundAmount: { ...paid, value: 200_000 },
  receiptEmail: "customer@example.test",
};

/** The withdrawal service, recording each call, behind a gate decided `released`. */
const withdrawals = (
  released: boolean,
  service: Partial<WithdrawalService["Service"]> = {}
) => {
  const calls: string[] = [];
  const layer = Layer.mergeAll(
    Layer.mock(WithdrawalService, {
      quote: (input) =>
        Effect.suspend(() => {
          calls.push(`quote ${input.contract.id} ${input.locale}`);
          return service.quote ? service.quote(input) : Effect.succeed(quote);
        }),
      withdraw: (input) =>
        Effect.suspend(() => {
          calls.push(
            `withdraw ${input.contract.id} ${input.locale}${input.customerName === undefined ? "" : ` as ${input.customerName}`}`
          );
          return service.withdraw
            ? service.withdraw(input)
            : Effect.succeed(receipt);
        }),
    }),
    WithdrawalReleaseGate.fromDecision(released)
  );
  return { calls, reservations: { withdrawals: layer } };
};

describe("customer API withdrawal endpoints", () => {
  testCustomerEndpointGuards(quoteCall);
  testCustomerEndpointGuards(withdrawCall);

  test("are unavailable while the online withdrawal function isn't released", async () => {
    const { calls, reservations } = withdrawals(false);
    const api = makeCustomerApiTestServer({ reservations });

    for (const call of [quoteCall, withdrawCall]) {
      const response = await api.handle(customerApiRequest(call));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        _tag: "CustomerFeatureUnavailable",
        feature: "withdrawal",
      });
    }
    expect(calls).toEqual([]);
  });

  test("quotes the order's withdrawal in the requested language", async () => {
    const { calls, reservations } = withdrawals(true);
    const api = makeCustomerApiTestServer({ reservations });

    const response = await api.handle(customerApiRequest(quoteCall));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...quote,
      periodEndsAt: "2027-01-16T23:00:00Z",
    });
    expect(calls).toEqual(["quote reservation-1 en-US"]);
  });

  test("answers the receipt of a submitted withdrawal", async () => {
    const { calls, reservations } = withdrawals(true);
    const api = makeCustomerApiTestServer({ reservations });

    const response = await api.handle(customerApiRequest(withdrawCall));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...receipt,
      submittedAt: "2027-01-10T08:00:00Z",
    });
    expect(calls).toEqual(["withdraw reservation-1 en-US"]);
  });

  test("answers a refusal with its reason, and another account's order as not found", async () => {
    const refusing = (reason: WithdrawalRefusedError["reason"]) =>
      withdrawals(true, {
        withdraw: () => Effect.fail(new WithdrawalRefusedError({ reason })),
      });

    const refused = await makeCustomerApiTestServer({
      reservations: refusing("period_ended").reservations,
    }).handle(customerApiRequest(withdrawCall));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      _tag: "CustomerWithdrawalRefused",
      reason: "period_ended",
    });

    const notFound = await makeCustomerApiTestServer({
      reservations: refusing("not_found").reservations,
    }).handle(customerApiRequest(withdrawCall));
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toMatchObject({
      _tag: "CustomerReservationNotFound",
    });
  });

  test("passes the typed name with the statement", async () => {
    const { calls, reservations } = withdrawals(true);
    const api = makeCustomerApiTestServer({ reservations });

    const response = await api.handle(
      customerApiRequest({
        ...withdrawCall,
        body: { locale: "en-US", customerName: "Sam Typed" },
      })
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual(["withdraw reservation-1 en-US as Sam Typed"]);
  });

  test("answers a statement without a name as unprocessable", async () => {
    const { reservations } = withdrawals(true, {
      withdraw: () => Effect.fail(new WithdrawalNameRequiredError()),
    });

    const response = await makeCustomerApiTestServer({ reservations }).handle(
      customerApiRequest(withdrawCall)
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      _tag: "CustomerWithdrawalNameRequired",
    });
  });
});
