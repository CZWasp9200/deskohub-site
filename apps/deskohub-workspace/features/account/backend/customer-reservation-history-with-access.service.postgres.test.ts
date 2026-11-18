import {
  type InMemoryDotyposRequest,
  makeInMemoryDotypos,
} from "@deskohub/dotypos/testing";
import { testEmailAddress } from "@deskohub/test-email";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  type DotyposReservation,
  DotyposReservationIdSchema,
  DotyposReservationSchema,
  DotyposService,
} from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import type { CustomerReservationSummary } from "@/features/account/contracts";
import { getReservationProductName } from "@/features/account/reservation-product-name";
import {
  WorkspaceCheckoutAccessCodeService,
  type WorkspaceCheckoutAccessCodeService as WorkspaceCheckoutAccessCodeServiceType,
} from "@/features/checkout/backend/reservation/access-code.service";
import { ReservationAccessService } from "@/features/reservation/backend/reservation-access.service";
import { ReservationAuthorizationService } from "@/features/reservation/backend/reservation-authorization.service";
import { ReservationRecords } from "@/features/reservation/backend/reservation-records";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type StoredWorkspaceReservationDetails,
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { ReservationAccessIssuanceError } from "@/features/reservation-access";
import { ReviewAccounts, ReviewSandbox } from "@/features/review-accounts";
import {
  type ReservationFixtureStage,
  workspaceFixtures,
} from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { temporalInstantToIsoString } from "@/shared/utils/temporal";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "../customer-account";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import { CustomerReservationHistoryWithAccessService } from "./customer-reservation-history-with-access.service";
import { ReservationAuthorDirectory } from "./reservation-author-directory.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const uniqueDotyposId = () =>
  `${Math.floor(Math.random() * 900000) + 100000}${Math.floor(
    Math.random() * 900
  )}`;

const testDatabaseLayer = () =>
  Layer.succeed(WorkspaceDatabase, WorkspaceDatabase.make(testDatabase!.db));

const accessCode = ["fixture", "door"].join("-");

/** The next midnight in Prague after `now`. */
const nextPragueMidnight = (now: Temporal.Instant) =>
  now
    .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
    .toPlainDate()
    .add({ days: 1 })
    .toZonedDateTime(workspaceSiteConstants.location.timeZone)
    .toInstant();

type Booking = {
  readonly label: string;
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
  readonly stage?: ReservationFixtureStage;
  readonly details?: StoredWorkspaceReservationDetails;
};

const paidConfirmed: ReservationFixtureStage = {
  reservation: "confirmed",
  payment: "paid",
  fulfillment: "fulfilled",
};

/**
 * A linked account whose customer holds `bookings`, each booked on the
 * website, in Dotypos and in Workspace.
 */
const seedAccount = async (bookings: readonly Booking[]) => {
  const accountId = customerAccountIdSchema.make(crypto.randomUUID());
  const customerId = DotyposCustomerIdSchema.make(uniqueDotyposId());
  const fixtures = workspaceFixtures(testDatabase!.db);
  await Effect.runPromise(
    fixtures.account("history", {
      id: accountId,
      email: testEmailAddress(`ha-${accountId}`),
      verified: false,
      linkedCustomer: customerId,
    })
  );
  const reservations: DotyposReservation[] = [];
  const orders = new Map<string, WorkspaceReservationId>();
  for (const booking of bookings) {
    const orderId = workspaceReservationIdSchema.make(crypto.randomUUID());
    const dotyposReservationId = DotyposReservationIdSchema.make(
      uniqueDotyposId()
    );
    reservations.push(
      Schema.decodeUnknownSync(DotyposReservationSchema)({
        id: dotyposReservationId,
        _branchId: "branch",
        _cloudId: "cloud",
        _customerId: customerId,
        startDate: booking.startsAt.toString(),
        endDate: booking.endsAt.toString(),
        seats: "1",
        status: "CONFIRMED",
      })
    );
    await Effect.runPromise(
      fixtures.reservation({
        stage: booking.stage ?? paidConfirmed,
        customer: customerId,
        author: accountId,
        ...(booking.details && { details: booking.details }),
        overrides: { id: orderId, dotyposReservationId },
      })
    );
    orders.set(booking.label, orderId);
  }
  return { accountId, customerId, reservations, orders };
};

const makeHistory = (input: {
  readonly reservations: readonly DotyposReservation[];
  readonly resolveCode: WorkspaceCheckoutAccessCodeServiceType["resolveCustomerAccessCode"];
}) => {
  const requests: InMemoryDotyposRequest[] = [];
  const dotypos = makeInMemoryDotypos(
    { reservations: input.reservations },
    {
      onRequest: (request) => {
        requests.push(request);
        return Effect.void;
      },
    }
  );
  const resolveCustomerAccessCode = mock(input.resolveCode);
  const dotyposLayer = Layer.succeed(DotyposService, dotypos.service);
  const access = ReservationAccessService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        dotyposLayer,
        WorkspaceReservationRepository.Default.pipe(
          Layer.provide(testDatabaseLayer())
        ),
        Layer.succeed(ReservationAuthorizationService, {
          isAuthorized: () => Effect.succeed(true),
          authorize: () => Effect.succeed(true),
        }),
        Layer.succeed(WorkspaceCheckoutAccessCodeService, {
          resolveCustomerAccessCode,
        })
      )
    )
  );
  const layer = CustomerReservationHistoryWithAccessService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        testDatabaseLayer(),
        dotyposLayer,
        // Shared snapshots the service must never read: it lists live.
        Layer.mock(ReservationRecords, {
          get: () => Effect.die("read a snapshot record"),
          listForCustomer: () => Effect.die("read a snapshot list"),
          listByIds: () => Effect.die("read snapshot records"),
        }),
        access,
        ReviewAccounts.Default.pipe(Layer.provide(testDatabaseLayer())),
        ReviewSandbox.Default.pipe(Layer.provide(testDatabaseLayer())),
        ReservationAuthorDirectory.Default.pipe(
          Layer.provide(testDatabaseLayer())
        ),
        CustomerAccountLinkRepository.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              testDatabaseLayer(),
              WorkspaceDatabaseAdvisoryLock.makeLayer(
                testDatabase!.databasePool
              )
            )
          )
        )
      )
    )
  );
  const load = (
    account: {
      readonly accountId: CustomerAccountId;
      readonly dotyposCustomerId?: DotyposCustomerId;
    },
    locale: "en-US" | "cs-CZ" = "en-US"
  ) =>
    Effect.flatMap(CustomerReservationHistoryWithAccessService, (history) =>
      history.load(account, { locale })
    ).pipe(Effect.provide(layer), Effect.runPromise);
  return { load, requests, resolveCustomerAccessCode };
};

const issued = (input: {
  readonly reservedFrom: Temporal.Instant;
  readonly reservedUntil: Temporal.Instant;
}) =>
  Effect.succeed({
    code: accessCode,
    accessStartsAt: input.reservedFrom,
    accessEndsAt: input.reservedUntil,
  });

const entriesOf = (
  history: Awaited<ReturnType<ReturnType<typeof makeHistory>["load"]>>
): readonly CustomerReservationSummary[] => {
  if (history.kind !== "available") throw new Error("history unavailable");
  return [
    ...history.groups.current,
    ...history.groups.past,
    ...history.groups.unavailable,
  ];
};

const entryOf = (
  entries: readonly CustomerReservationSummary[],
  orderId: WorkspaceReservationId | undefined
) => {
  const entry = entries.find(
    (candidate) => candidate.workspaceReservationId === orderId
  );
  if (!entry) throw new Error("entry missing");
  return entry;
};

describe.skipIf(!testDatabase)(
  "CustomerReservationHistoryWithAccessService on disposable Postgres",
  () => {
    test("shows the door code of confirmed bookings with access by today in Prague, from the records the history read", async () => {
      const now = Temporal.Now.instant();
      const midnight = nextPragueMidnight(now);
      const seeded = await seedAccount([
        {
          label: "started",
          startsAt: now.subtract({ minutes: 1 }),
          endsAt: now.add({ hours: 1 }),
        },
        {
          // Halfway to midnight is still today in Prague.
          label: "later-today",
          startsAt: now.add({
            nanoseconds: Number(
              (midnight.epochNanoseconds - now.epochNanoseconds) / 2n
            ),
          }),
          endsAt: midnight.add({ hours: 1 }),
        },
        {
          label: "tomorrow",
          startsAt: midnight.add({ minutes: 1 }),
          endsAt: midnight.add({ hours: 2 }),
        },
        {
          label: "ended",
          startsAt: now.subtract({ hours: 3 }),
          endsAt: now.subtract({ hours: 2 }),
        },
        {
          label: "cancelled",
          startsAt: now.subtract({ minutes: 1 }),
          endsAt: now.add({ hours: 1 }),
          stage: { reservation: "cancelled", payment: "paid" },
        },
      ]);
      const history = makeHistory({
        reservations: seeded.reservations,
        resolveCode: issued,
      });

      const entries = entriesOf(
        await history.load({
          accountId: seeded.accountId,
          dotyposCustomerId: seeded.customerId,
        })
      );

      for (const label of ["started", "later-today"]) {
        const entry = entryOf(entries, seeded.orders.get(label));
        expect(entry.todayAccess).toEqual({
          code: accessCode,
          accessStartsAt: entry.accessStartsAt!,
          accessEndsAt: entry.accessEndsAt!,
        });
      }
      for (const label of ["tomorrow", "ended", "cancelled"]) {
        expect(
          entryOf(entries, seeded.orders.get(label)).todayAccess
        ).toBeUndefined();
      }
      expect(history.resolveCustomerAccessCode).toHaveBeenCalledTimes(2);
      // The codes come from the records the history listed: no item reads.
      expect(history.requests.map(({ operation }) => operation)).not.toContain(
        "getReservation"
      );
      expect(
        history.requests.filter(
          ({ operation }) => operation === "listReservations"
        )
      ).toHaveLength(1);
    });

    test("leaves a booking whose code can't be shown without one and still lists the rest", async () => {
      const now = Temporal.Now.instant();
      const seeded = await seedAccount([
        {
          label: "issuance-fails",
          startsAt: now.subtract({ minutes: 1 }),
          endsAt: now.add({ hours: 1 }),
        },
        {
          label: "issued",
          startsAt: now.subtract({ minutes: 2 }),
          endsAt: now.add({ hours: 1 }),
        },
      ]);
      const failing = seeded.orders.get("issuance-fails");
      const history = makeHistory({
        reservations: seeded.reservations,
        resolveCode: (input) =>
          input.reservationId === failing
            ? Effect.fail(
                new ReservationAccessIssuanceError({
                  reservationId: input.reservationId,
                  outcome: "uncertain",
                  message: "Lock provider unavailable.",
                })
              )
            : issued(input),
      });

      const entries = entriesOf(
        await history.load({
          accountId: seeded.accountId,
          dotyposCustomerId: seeded.customerId,
        })
      );

      expect(entryOf(entries, failing).todayAccess).toBeUndefined();
      expect(
        entryOf(entries, seeded.orders.get("issued")).todayAccess?.code
      ).toBe(accessCode);
    });

    test("names each booking in the locale asked for, with its access window and the booking that repeats it", async () => {
      const now = Temporal.Now.instant();
      const startsAt = nextPragueMidnight(now).add({ hours: 48 });
      const seeded = await seedAccount([
        {
          label: "open-space",
          startsAt,
          endsAt: startsAt.add({ hours: 17 }),
          details: { kind: "cowork", entryTier: "open-space", coffee: true },
        },
      ]);
      const history = makeHistory({
        reservations: seeded.reservations,
        resolveCode: issued,
      });

      const entry = entryOf(
        entriesOf(
          await history.load(
            {
              accountId: seeded.accountId,
              dotyposCustomerId: seeded.customerId,
            },
            "cs-CZ"
          )
        ),
        seeded.orders.get("open-space")
      );

      expect(entry.productName).toBe(
        getReservationProductName(
          { kind: "cowork", tier: "open-space" },
          "cs-CZ"
        )
      );
      expect(entry.accessStartsAt).toBe(temporalInstantToIsoString(startsAt));
      expect(entry.accessEndsAt).toBe(
        temporalInstantToIsoString(startsAt.add({ hours: 17 }))
      );
      expect(entry.bookedSelection).toEqual({
        selection: {
          family: "cowork",
          date: startsAt
            .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
            .toPlainDate()
            .toString(),
          tier: "open-space",
          coffee: true,
        },
      });
      expect(entry.todayAccess).toBeUndefined();
      expect(history.resolveCustomerAccessCode).not.toHaveBeenCalled();
    });

    test("shows a review account's sandbox with names and selections but never a code", async () => {
      const seeded = await seedAccount([]);
      await testDatabase!.pool.query(
        // A review account never has a Dotypos customer.
        "update customer_accounts set review = true, dotypos_customer_id = null where id = $1",
        [seeded.accountId]
      );
      const history = makeHistory({
        reservations: [],
        resolveCode: issued,
      });

      const entries = entriesOf(
        await history.load({
          accountId: seeded.accountId,
        })
      );

      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.reviewSandbox).toBe(true);
        expect(entry.productName).toBe(
          getReservationProductName(entry.product, "en-US")
        );
        expect(entry.todayAccess).toBeUndefined();
      }
      expect(entries.some((entry) => entry.bookedSelection)).toBe(true);
      expect(history.resolveCustomerAccessCode).not.toHaveBeenCalled();
      expect(history.requests).toEqual([]);
    });
  }
);
