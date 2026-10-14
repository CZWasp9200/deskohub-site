import { describe, expect, mock, test } from "bun:test";
import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
  NetworkError,
} from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { testEmailAddress } from "@deskohub/test-email";
import { Cause, Effect, Exit, Layer } from "effect";
import type { AudienceFilter } from "../audience-filter";
import {
  type CampaignCandidateFacts,
  CampaignCandidateRepository,
  type CampaignReservationCustomerQuery,
} from "./campaign-candidate.repository";
import { CampaignRecipientService } from "./campaign-recipient.service";

const customerId = (value: string) => DotyposCustomerIdSchema.make(value);

const facts = (
  id: string,
  overrides: Partial<CampaignCandidateFacts> = {}
): CampaignCandidateFacts => ({
  dotyposCustomerId: customerId(id),
  hasAccount: false,
  accountLocale: null,
  latestReservationLocale: null,
  latestReservationAt: null,
  consentLocale: null,
  ...overrides,
});

const customer = (
  id: string,
  overrides: Partial<DotyposCustomer> = {}
): DotyposCustomer =>
  ({
    id,
    _cloudId: "cloud",
    email: testEmailAddress(`customer-${id}`),
    points: "0",
    flags: "0",
    display: true,
    deleted: false,
    ...overrides,
  }) as DotyposCustomer;

const everyone: AudienceFilter = {
  _tag: "Group",
  operator: "and",
  filters: [],
};

const resolve = (input: {
  readonly candidates: readonly CampaignCandidateFacts[];
  readonly customers?: readonly DotyposCustomer[];
  readonly filter?: AudienceFilter;
  readonly purpose?: "marketing" | "operational";
  readonly reservationCustomers?: (
    query: CampaignReservationCustomerQuery
  ) => readonly DotyposCustomerId[];
  readonly dotypos?: Parameters<typeof DotyposServiceMock>[0];
}) => {
  const listCandidates = mock(() => Effect.succeed(input.candidates));
  const listReservationCustomers = mock(
    (query: CampaignReservationCustomerQuery) =>
      Effect.succeed(new Set(input.reservationCustomers?.(query) ?? []))
  );
  const getCustomers = mock(
    ({ ids }: { readonly ids: readonly DotyposCustomerId[] }) =>
      Effect.succeed(
        (input.customers ?? []).filter(
          ({ id }) => id !== undefined && ids.includes(id)
        )
      )
  );
  const exit = Effect.runSyncExit(
    CampaignRecipientService.use((service) =>
      service.resolve({
        purpose: input.purpose ?? "operational",
        filter: input.filter ?? everyone,
      })
    ).pipe(
      Effect.provide(
        CampaignRecipientService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(CampaignCandidateRepository)({
                listCandidates,
                listReservationCustomers,
              }),
              DotyposServiceMock({ getCustomers, ...input.dotypos })
            )
          )
        )
      )
    )
  );
  return { exit, listCandidates, listReservationCustomers, getCustomers };
};

const resolution = (exit: ReturnType<typeof resolve>["exit"]) => {
  if (Exit.isFailure(exit)) throw new Error("resolution failed");
  return exit.value;
};

describe("CampaignRecipientService.resolve", () => {
  test("limits marketing campaigns to the consented candidate pool", () => {
    const { listCandidates } = resolve({
      candidates: [],
      purpose: "marketing",
    });
    expect(listCandidates).toHaveBeenCalledWith({ purpose: "marketing" });
  });

  test("resolves the recipient locale from account, reservation, consent, then Czech", () => {
    const { exit } = resolve({
      candidates: [
        facts("1", { accountLocale: "en-US", consentLocale: "cs-CZ" }),
        facts("2", { latestReservationLocale: "en-US" }),
        facts("3"),
      ],
      customers: [customer("1"), customer("2"), customer("3")],
    });
    expect(
      resolution(exit).recipients.map(({ dotyposCustomerId, locale }) => [
        dotyposCustomerId,
        locale,
      ])
    ).toEqual([
      ["1", "en-US"],
      ["2", "en-US"],
      ["3", "cs-CZ"],
    ]);
  });

  test("drops customers local conditions rule out before calling Dotypos", () => {
    const { exit, getCustomers } = resolve({
      candidates: [facts("1", { hasAccount: true }), facts("2")],
      customers: [customer("1"), customer("2")],
      filter: { _tag: "Account", hasAccount: true },
    });
    expect(getCustomers).toHaveBeenCalledTimes(1);
    expect(getCustomers.mock.calls[0]?.[0].ids).toEqual(["1"]);
    expect(
      resolution(exit).recipients.map(
        ({ dotyposCustomerId }) => dotyposCustomerId
      )
    ).toEqual(["1"]);
  });

  test("hydrates survivors sequentially in chunks of 100", () => {
    const candidates = Array.from({ length: 250 }, (_, index) =>
      facts(String(index).padStart(3, "0"))
    );
    const { getCustomers } = resolve({
      candidates,
      customers: candidates.map(({ dotyposCustomerId }) =>
        customer(dotyposCustomerId)
      ),
    });
    expect(getCustomers.mock.calls.map(([{ ids }]) => ids.length)).toEqual([
      100, 100, 50,
    ]);
  });

  test("applies Dotypos tag and discount-group conditions after hydration", () => {
    const { exit } = resolve({
      candidates: [facts("1"), facts("2"), facts("3")],
      customers: [
        customer("1", { tags: ["vip"] }),
        customer("2", { tags: ["vip"], _discountGroupId: null }),
        customer("3", { tags: [] }),
      ],
      filter: {
        _tag: "Group",
        operator: "and",
        filters: [
          { _tag: "DotyposTag", tag: "vip" },
          {
            _tag: "Group",
            operator: "or",
            filters: [
              { _tag: "Locale", locales: ["cs-CZ"] },
              { _tag: "DiscountGroup", discountGroupId: "gold" },
            ],
          },
        ],
      },
    });
    expect(
      resolution(exit).recipients.map(
        ({ dotyposCustomerId }) => dotyposCustomerId
      )
    ).toEqual(["1", "2"]);
  });

  test("lists matching customers it can't reach with a reason", () => {
    const { exit } = resolve({
      candidates: ["1", "2", "3", "4", "5"].map((id) => facts(id)),
      customers: [
        customer("2", { deleted: true }),
        customer("3", { email: "  " }),
        customer("4", { email: "not-an-address" }),
        customer("5"),
      ],
    });
    const { recipients, exclusions } = resolution(exit);
    expect(exclusions).toEqual([
      { dotyposCustomerId: customerId("1"), reason: "missing-from-dotypos" },
      { dotyposCustomerId: customerId("2"), reason: "deleted-customer" },
      { dotyposCustomerId: customerId("3"), reason: "missing-email" },
      { dotyposCustomerId: customerId("4"), reason: "invalid-email" },
    ]);
    expect(
      recipients.map(({ dotyposCustomerId }) => dotyposCustomerId)
    ).toEqual(["5"]);
  });

  test("mails one record per address and reports the duplicate group", () => {
    const shared = testEmailAddress("shared");
    const run = (order: readonly string[]) =>
      resolution(
        resolve({
          candidates: order.map((id) =>
            facts(id, {
              latestReservationAt:
                id === "b"
                  ? Temporal.Instant.from("2026-05-01T00:00:00Z")
                  : null,
            })
          ),
          customers: [
            customer("a", { email: shared.toUpperCase() }),
            customer("b", { email: ` ${shared}` }),
            customer("c", { email: shared }),
          ],
        }).exit
      );
    const forward = run(["a", "b", "c"]);
    expect(run(["c", "b", "a"])).toEqual(forward);
    expect(forward.recipients).toEqual([
      { dotyposCustomerId: customerId("b"), locale: "cs-CZ", email: shared },
    ]);
    expect(forward.duplicates).toEqual([
      {
        email: shared,
        recipientCustomerId: customerId("b"),
        duplicateCustomerIds: [customerId("a"), customerId("c")],
      },
    ]);
  });

  test("matches visit dates through Dotypos and booking dates locally", () => {
    const visitedReservation = DotyposReservationIdSchema.make("booking-1");
    const listReservations = mock(() =>
      Effect.succeed([{ id: visitedReservation }] as never)
    );
    const { exit, listReservationCustomers } = resolve({
      candidates: [facts("1"), facts("2")],
      customers: [customer("1"), customer("2")],
      dotypos: { listReservations },
      reservationCustomers: (query) =>
        query.dotyposReservationIds ? [customerId("1")] : [customerId("2")],
      filter: {
        _tag: "Group",
        operator: "or",
        filters: [
          {
            _tag: "Reservation",
            presence: "has",
            dateBasis: "visit",
            from: "2026-03-01",
            to: "2026-03-31",
            status: "complete",
          },
          {
            _tag: "Reservation",
            presence: "has",
            dateBasis: "booking",
            from: "2026-03-01",
          },
        ],
      },
    });
    expect(listReservations).toHaveBeenCalledWith({
      startsAtOrAfter: "2026-02-28T23:00:00Z",
      startsBefore: "2026-03-31T22:00:00Z",
    });
    expect(listReservationCustomers.mock.calls.map(([query]) => query)).toEqual(
      [
        { status: "complete", dotyposReservationIds: [visitedReservation] },
        {
          status: undefined,
          bookedAtOrAfter: Temporal.Instant.from("2026-02-28T23:00:00Z"),
          bookedBefore: undefined,
        },
      ]
    );
    expect(
      resolution(exit).recipients.map(
        ({ dotyposCustomerId }) => dotyposCustomerId
      )
    ).toEqual(["1", "2"]);
  });

  test("fails the whole resolution with a retryable error when Dotypos fails", () => {
    const { exit } = resolve({
      candidates: [facts("1"), facts("2")],
      dotypos: {
        getCustomers: () =>
          Effect.fail(new NetworkError({ message: "connection reset" })),
      },
    });
    expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({
      _tag: "CampaignRecipientResolutionError",
      source: "dotypos",
    });
  });
});
