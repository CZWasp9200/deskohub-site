import "@/shared/testing/workspace-test-env";

import { afterEach, describe, expect, test } from "bun:test";
import {
  DotyposReservationIdSchema,
  DotyposService,
  DotyposUnavailable,
} from "@deskohub/dotypos";
import { EmailServiceError } from "@deskohub/email/backend/service";
import { IgloohomeDeviceIdSchema } from "@deskohub/igloohome";
import { testEmailAddress } from "@deskohub/test-email";
import { NodeCrypto } from "@effect/platform-node";
import { eq } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { reservationInvitees, workspaceReservations } from "@/db/schema";
import { testCustomerSession } from "@/features/account/backend/account-operations.test-utils";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
import { CustomerAccountLinkRepository } from "@/features/account/backend/customer-account-link.repository";
import { CustomerAccountSections } from "@/features/account/backend/customer-account-sections";
import { CustomerDotyposAdapter } from "@/features/account/backend/customer-dotypos-adapter.service";
import { CustomerInvitedReservationsService } from "@/features/customer-api/customer-invited-reservations.service";
import {
  InviteeEmail,
  type ValidOfficePeople,
} from "@/features/office/office-people";
import { ReservationAccessService } from "@/features/reservation/backend/reservation-access.service";
import { ReservationRecords } from "@/features/reservation/backend/reservation-records";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { WorkspaceReservationService } from "@/features/reservation/backend/workspace-reservation.service";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import { ReservationAccessRepository } from "@/features/reservation-access/backend/reservation-access.repository";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import { syntheticSealedStateKeyRing } from "@/shared/testing/sealed-state-keys.test-utils";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { ReservationInvitations } from "./reservation-invitations.service";
import { ReservationInviteeEmailKeys } from "./reservation-invitee-email-keys.service";
import { ReservationInviteeNoticeWorker } from "./reservation-invitee-notice-worker";
import { ReservationInviteeRetention } from "./reservation-invitee-retention.service";
import {
  ReservationInvitees,
  recordOfficeInvitees,
  sealOfficePeople,
} from "./reservation-invitees.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const ringOld = syntheticSealedStateKeyRing(["invitee-old", 7]);
const ringRotated = syntheticSealedStateKeyRing(
  ["invitee-new", 9],
  ["invitee-old", 7]
);

const invitee = (localPart: string) =>
  InviteeEmail.make(testEmailAddress(`invitee-${localPart}`));

describe.skipIf(!testDatabase)("ReservationInvitees on Postgres", () => {
  if (!testDatabase) return;
  const reservationIds: WorkspaceReservationId[] = [];
  const fixtures = workspaceFixtures(testDatabase.db);

  afterEach(async () => {
    await testDatabase.pool.query(
      "delete from reservation_access_grants where workspace_reservation_id = any($1)",
      [reservationIds]
    );
    await testDatabase.pool.query(
      "delete from workspace_reservations where id = any($1)",
      [reservationIds]
    );
    reservationIds.length = 0;
  });

  const run = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      ReservationInvitees | ReservationInviteeEmailKeys | WorkspaceDatabase
    >,
    ring = ringOld
  ) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provide(
          ReservationInvitees.Live.pipe(
            Layer.provideMerge(ReservationInviteeEmailKeys.Live),
            Layer.provide(SealedStateKeys.fromConfiguration(ring)),
            Layer.provideMerge(testDatabase.layer)
          )
        )
      )
    );

  const insertReservation = async (
    stage: Parameters<typeof fixtures.reservation>[0]["stage"] = {
      reservation: "confirmed",
      payment: "paid",
    }
  ) => {
    const { id } = await Effect.runPromise(fixtures.reservation({ stage }));
    reservationIds.push(id);
    return id;
  };

  const record = (
    reservationId: WorkspaceReservationId,
    people: ValidOfficePeople,
    options: {
      readonly accessEndsAt?: Temporal.Instant;
      readonly ring?: string;
    } = {}
  ) =>
    run(
      Effect.gen(function* () {
        const sealed = yield* sealOfficePeople(
          people,
          options.accessEndsAt ?? Temporal.Instant.from("2030-03-05T23:00:00Z")
        );
        const { transaction } = yield* WorkspaceDatabase;
        yield* transaction(recordOfficeInvitees(reservationId, sealed));
      }),
      options.ring
    );

  test("stores invitees encrypted and lists them in order", async () => {
    const reservationId = await insertReservation();
    const people = {
      contactAttends: true,
      invitees: [invitee("list-b"), invitee("list-a")],
    };
    await record(reservationId, people);

    const [raw] = await Effect.runPromise(
      testDatabase.db
        .select({
          encryptedEmail: reservationInvitees.encryptedEmail,
          emailLookupKey: reservationInvitees.emailLookupKey,
        })
        .from(reservationInvitees)
        .where(eq(reservationInvitees.workspaceReservationId, reservationId))
        .limit(1)
    );
    expect(Buffer.from(raw?.encryptedEmail ?? []).toString()).not.toContain(
      "invitee-list"
    );
    expect(raw?.emailLookupKey).not.toContain("invitee-list");

    const listed = await run(
      ReservationInvitees.use((invitees) =>
        invitees.listForReservation(reservationId)
      )
    );
    expect(listed.map(({ email, position }) => ({ email, position }))).toEqual([
      { email: people.invitees[0] ?? null, position: 0 },
      { email: people.invitees[1] ?? null, position: 1 },
    ]);
  });

  test("finds an invitee's reservations by verified email under every configured key", async () => {
    const reservationId = await insertReservation();
    const email = invitee("rotated");
    await record(reservationId, { contactAttends: false, invitees: [email] });

    const account = await Effect.runPromise(fixtures.customerAccount());
    const found = await run(
      ReservationInvitees.use((invitees) =>
        invitees.findInvitedReservations({
          accountId: account,
          email: ` ${email.toUpperCase()} `,
        })
      ),
      ringRotated
    );
    expect(found).toContain(reservationId);

    const listed = await run(
      ReservationInvitees.use((invitees) =>
        invitees.listForReservation(reservationId)
      ),
      ringRotated
    );
    expect(listed[0]?.email).toBe(email);
  });

  test("fails to open an address whose key is no longer configured", async () => {
    const reservationId = await insertReservation();
    await record(reservationId, {
      contactAttends: false,
      invitees: [invitee("retired")],
    });

    const opened = await run(
      ReservationInvitees.use((invitees) =>
        invitees.listForReservation(reservationId)
      ).pipe(Effect.flip),
      syntheticSealedStateKeyRing(["invitee-new", 9])
    );
    expect(opened.operation).toBe("key");
  });

  test("claims a resend only after the cooldown", async () => {
    const reservationId = await insertReservation();
    await record(reservationId, {
      contactAttends: true,
      invitees: [invitee("resend")],
    });
    const [row] = await run(
      ReservationInvitees.use((invitees) =>
        invitees.listForReservation(reservationId)
      )
    );
    if (!row) throw new Error("missing invitee row");
    const sentAt = Temporal.Instant.from("2030-03-01T10:00:00Z");
    const cooldown = Temporal.Duration.from({ seconds: 60 });

    await run(
      ReservationInvitees.use((invitees) =>
        invitees.markInvitationSent({ inviteeId: row.id, sendCount: 1, sentAt })
      )
    );
    const tooSoon = await run(
      ReservationInvitees.use((invitees) =>
        invitees.claimResend({
          inviteeId: row.id,
          sentAt: sentAt.add({ seconds: 59 }),
          cooldown,
          previousSendCount: 1,
        })
      )
    );
    const claimed = await run(
      ReservationInvitees.use((invitees) =>
        invitees.claimResend({
          inviteeId: row.id,
          sentAt: sentAt.add({ seconds: 60 }),
          cooldown,
          previousSendCount: 1,
        })
      )
    );
    expect(Option.isNone(tooSoon)).toBe(true);
    expect(claimed).toEqual(Option.some(2));
    const resentAt = sentAt.add({ seconds: 60 });
    await run(
      ReservationInvitees.use((invitees) =>
        invitees.releaseFailedResend({
          inviteeId: row.id,
          sendCount: 2,
          sentAt: resentAt,
          previousSentAt: sentAt,
        })
      )
    );
    const reclaimed = await run(
      ReservationInvitees.use((invitees) =>
        invitees.claimResend({
          inviteeId: row.id,
          sentAt: resentAt,
          cooldown,
          previousSendCount: 1,
        })
      )
    );
    expect(reclaimed).toEqual(Option.some(2));
  });

  test("lists rows due after retention, honouring a later access end", async () => {
    const accessEndsAt = Temporal.Instant.from("2030-03-05T23:00:00Z");
    const due = await insertReservation();
    await record(
      due,
      { contactAttends: true, invitees: [invitee("due")] },
      {
        accessEndsAt,
      }
    );
    const rescheduled = await insertReservation();
    await record(
      rescheduled,
      { contactAttends: true, invitees: [invitee("rescheduled")] },
      { accessEndsAt }
    );
    await Effect.runPromise(
      ReservationAccessRepository.use((repository) =>
        repository.ensure({
          reservationId: rescheduled,
          deviceId: IgloohomeDeviceIdSchema.make("synthetic-keypad"),
          scheduledAccessStartsAt: Temporal.Instant.from(
            "2030-03-10T08:00:00Z"
          ),
          accessStartsAt: Temporal.Instant.from("2030-03-10T08:00:00Z"),
          accessEndsAt: Temporal.Instant.from("2030-03-10T23:00:00Z"),
          replacingIssued: null,
        })
      ).pipe(
        Effect.provide(ReservationAccessRepository.Default),
        Effect.provide(NodeCrypto.layer),
        Effect.provide(testDatabase.layer)
      )
    );
    const abandoned = await insertReservation({ reservation: "hold_expired" });
    await record(abandoned, {
      contactAttends: false,
      invitees: [invitee("abandoned")],
    });

    const retryable = await insertReservation({
      reservation: "hold_expired",
      payment: "failed",
    });
    await record(
      retryable,
      { contactAttends: false, invitees: [invitee("retryable")] },
      { accessEndsAt: Temporal.Instant.from("2030-04-20T22:00:00Z") }
    );

    const rejected = await insertReservation({ reservation: "draft" });
    await record(
      rejected,
      { contactAttends: false, invitees: [invitee("rejected")] },
      { accessEndsAt }
    );
    await run(
      WorkspaceReservationRepository.use((repository) =>
        Effect.gen(function* () {
          expect(yield* repository.claimHoldCreation(rejected)).toBe(true);
          yield* repository.releaseHoldCreation(rejected);
          expect((yield* repository.findById(rejected))?.reservationState).toBe(
            "draft"
          );
        })
      ).pipe(Effect.provide(WorkspaceReservationRepository.Default))
    );
    const recentDraft = await insertReservation({ reservation: "draft" });
    await record(
      recentDraft,
      { contactAttends: false, invitees: [invitee("recent-draft")] },
      {
        accessEndsAt: Temporal.Instant.from("2030-04-20T22:00:00Z"),
      }
    );

    const listed = await run(
      ReservationInvitees.use((invitees) =>
        invitees.listDue({
          now: Temporal.Instant.from("2030-04-06T00:00:00Z"),
          limit: 1000,
        })
      )
    );
    const byReservation = (id: WorkspaceReservationId) =>
      listed.filter((row) => row.reservationId === id);

    expect(byReservation(due)).toEqual([
      expect.objectContaining({ paid: true }),
    ]);
    expect(byReservation(rescheduled)).toEqual([]);
    expect(byReservation(retryable)).toEqual([]);
    expect(byReservation(recentDraft)).toEqual([]);
    expect(byReservation(rejected)).toEqual([
      expect.objectContaining({ paid: false }),
    ]);
    expect(byReservation(abandoned)).toEqual([
      expect.objectContaining({ paid: false }),
    ]);
  });

  test("records each initial guest notice with the paid confirmation", async () => {
    const id = await insertReservation({
      reservation: "held",
      payment: "paid",
      fulfillment: "processing",
    });
    await Effect.runPromise(
      testDatabase.db
        .update(workspaceReservations)
        .set({
          officeContactAttends: false,
          reservationDetails: { kind: "office", seats: 2, dayCount: 1 },
        })
        .where(eq(workspaceReservations.id, id))
    );
    await record(id, {
      contactAttends: false,
      invitees: [invitee("transition-a"), invitee("transition-b")],
    });
    await run(
      WorkspaceReservationRepository.use((repository) =>
        repository.markReservationConfirmed({
          id,
          confirmedAt: Temporal.Instant.from("2029-12-01T12:00:00Z"),
        })
      ).pipe(Effect.provide(WorkspaceReservationRepository.Default))
    );
    const rows = await testDatabase.pool.query<{ kind: string }>(
      "select n.kind from reservation_invitee_notices n join reservation_invitees i on i.id = n.invitee_id where i.workspace_reservation_id = $1",
      [id]
    );
    expect(rows.rows).toEqual([{ kind: "invitation" }, { kind: "invitation" }]);
  });

  test("records staff guest notices even without a booker cancellation receipt", async () => {
    const id = await insertReservation();
    await Effect.runPromise(
      testDatabase.db
        .update(workspaceReservations)
        .set({
          officeContactAttends: false,
          reservationDetails: { kind: "office", seats: 1, dayCount: 1 },
        })
        .where(eq(workspaceReservations.id, id))
    );
    await record(id, {
      contactAttends: false,
      invitees: [invitee("staff-transition")],
    });
    const cancelledAt = Temporal.Now.instant();
    const restoredAt = cancelledAt.add({ seconds: 1 });
    await run(
      Effect.gen(function* () {
        const reservations = yield* WorkspaceReservationRepository;
        const claimed = yield* reservations.claimAdministrationCancellation({
          id,
          staleCancellingBefore: cancelledAt.subtract({ hours: 1 }),
        });
        if (!claimed) throw new Error("expected a cancellation claim");
        yield* reservations.markAdministrationCancelled({
          id,
          cancelledAt,
          claimedAt: claimed.updatedAt,
          failureCode: null,
        });
        const { transaction } = yield* WorkspaceDatabase;
        const restored = yield* transaction(
          reservations.markAdministrationRestored({
            id,
            cancelledAt,
            restoredAt,
          })
        );
        expect(restored?.reservation.reservationState).toBe("confirmed");
        expect(restored?.reservation.cancellationEmailSentAt).toBeNull();
      }).pipe(Effect.provide(WorkspaceReservationRepository.Default))
    );
    const rows = await testDatabase.pool.query<{
      kind: string;
      pending: boolean;
    }>(
      "select n.kind, n.settled_at is null as pending from reservation_invitee_notices n join reservation_invitees i on i.id = n.invitee_id where i.workspace_reservation_id = $1 order by n.occurred_at",
      [id]
    );
    expect(rows.rows).toEqual([
      { kind: "cancellation", pending: false },
      { kind: "restoration", pending: true },
    ]);
  });

  test("retries all guest notice kinds across worker runs and skips superseded cancellation", async () => {
    const id = await insertReservation({
      reservation: "held",
      payment: "paid",
      fulfillment: "processing",
    });
    const office = { kind: "office", seats: 1, dayCount: 1 } as const;
    await Effect.runPromise(
      testDatabase.db
        .update(workspaceReservations)
        .set({ officeContactAttends: false, reservationDetails: office })
        .where(eq(workspaceReservations.id, id))
    );
    const address = invitee("worker-recovery");
    await record(id, { contactAttends: false, invitees: [address] });
    const repository = <A, E>(
      action: (
        reservations: WorkspaceReservationRepository["Service"]
      ) => Effect.Effect<A, E, WorkspaceDatabase>
    ) =>
      run(
        WorkspaceReservationRepository.use(action).pipe(
          Effect.provide(WorkspaceReservationRepository.Default)
        )
      );
    const start = Temporal.Now.instant().add({ hours: 1 });
    const tick = (minutes: number) => start.add({ minutes });
    await repository((reservations) =>
      reservations.markReservationConfirmed({ id, confirmedAt: tick(0) })
    );
    const row = await repository((reservations) => reservations.findById(id));
    if (!row?.dotyposReservationId) throw new Error("expected office hold");
    const providerId = DotyposReservationIdSchema.make(
      row.dotyposReservationId
    );

    let outage = true;
    let providerStatus: "CONFIRMED" | "CANCELLED" = "CONFIRMED";
    const attempts: Array<{ noticeId: string; kind: string; access?: string }> =
      [];
    const sent: string[] = [];
    const drain = (at: Temporal.Instant) =>
      run(
        ReservationInviteeNoticeWorker.use((worker) =>
          worker.drain({ now: at, limit: 20 })
        ).pipe(
          Effect.provide(
            ReservationInviteeNoticeWorker.Default.pipe(
              Layer.provide(
                Layer.mergeAll(
                  WorkspaceDatabaseAdvisoryLock.makeLayer(
                    testDatabase.databasePool
                  ),
                  Layer.mock(WorkspaceReservationService, {
                    getReservation: () =>
                      Effect.succeed({
                        id,
                        dotyposCustomerId: row.dotyposCustomerId,
                        authorAccountId: row.authorAccountId,
                        dotyposReservationId: providerId,
                        reservationDetails: office,
                        locale: "en-US",
                        customer: {
                          id: row.dotyposCustomerId,
                          _cloudId: "synthetic-cloud",
                          firstName: "Alex",
                          lastName: "Sample",
                          companyName: null,
                          email: null,
                          phone: null,
                          points: null,
                          flags: "0",
                          display: true,
                          deleted: false,
                        },
                        reservedFrom: Temporal.Instant.from(
                          "2030-03-04T23:00:00Z"
                        ),
                        reservedUntil: Temporal.Instant.from(
                          "2030-03-05T23:00:00Z"
                        ),
                        providerStatus,
                        seats: 1,
                        placement: {},
                      }),
                  }),
                  Layer.mock(ReservationInvitations, {
                    deliverNotice: ({
                      invitee: guest,
                      kind,
                      noticeId,
                      restoredAccess,
                    }) =>
                      Effect.suspend(() => {
                        if (guest.email !== address) return Effect.void;
                        attempts.push({
                          kind,
                          noticeId,
                          access: restoredAccess,
                        });
                        if (outage)
                          return Effect.fail(
                            new EmailServiceError("Synthetic provider outage")
                          );
                        sent.push(kind);
                        return Effect.void;
                      }),
                  })
                )
              )
            )
          )
        )
      );

    expect(await drain(tick(0))).toMatchObject({ deferred: 1, delivered: 0 });
    outage = false;
    await Promise.all([drain(tick(2)), drain(tick(2))]);
    expect(sent).toEqual(["invitation"]);
    expect(attempts[0]?.noticeId).toBe(attempts[1]?.noticeId);
    await Effect.runPromise(
      testDatabase.db
        .update(workspaceReservations)
        .set({ fulfillmentState: "fulfilled", fulfilledAt: tick(2) })
        .where(eq(workspaceReservations.id, id))
    );

    const cancel = (cancelledAt: Temporal.Instant) =>
      repository((reservations) =>
        Effect.gen(function* () {
          const claimed = yield* reservations.claimAdministrationCancellation({
            id,
            staleCancellingBefore: cancelledAt.subtract({ hours: 2 }),
          });
          if (!claimed) throw new Error("expected a cancellation claim");
          yield* reservations.markAdministrationCancelled({
            id,
            cancelledAt,
            claimedAt: claimed.updatedAt,
            failureCode: null,
          });
          providerStatus = "CANCELLED";
        })
      );
    const restore = (
      cancelledAt: Temporal.Instant,
      restoredAt: Temporal.Instant
    ) =>
      repository((reservations) =>
        Effect.gen(function* () {
          const { transaction } = yield* WorkspaceDatabase;
          const restored = yield* transaction(
            reservations.markAdministrationRestored({
              id,
              cancelledAt,
              restoredAt,
            })
          );
          expect(restored?.reservation.cancellationEmailSentAt).toBeNull();
          providerStatus = "CONFIRMED";
        })
      );

    await cancel(tick(4));
    outage = true;
    expect(await drain(tick(4))).toMatchObject({ deferred: 1, delivered: 0 });
    outage = false;
    await drain(tick(6));
    expect(sent).toEqual(["invitation", "cancellation"]);
    expect(attempts[2]?.noticeId).toBe(attempts[3]?.noticeId);

    await restore(tick(4), tick(8));
    outage = true;
    expect(await drain(tick(8))).toMatchObject({ deferred: 1, delivered: 0 });
    expect(attempts[4]).toMatchObject({ kind: "restoration", access: "link" });
    outage = false;
    await drain(tick(10));
    expect(sent).toEqual(["invitation", "cancellation", "restoration"]);
    expect(attempts[4]?.noticeId).toBe(attempts[5]?.noticeId);

    await cancel(tick(12));
    outage = true;
    await drain(tick(12));
    await restore(tick(12), tick(13));
    outage = false;
    await drain(tick(15));
    expect(sent).toEqual([
      "invitation",
      "cancellation",
      "restoration",
      "restoration",
    ]);
  });

  test("signed-in invitation history includes the matching address and excludes unrelated accounts", async () => {
    const id = await insertReservation();
    await Effect.runPromise(
      testDatabase.db
        .update(workspaceReservations)
        .set({
          officeContactAttends: false,
          reservationDetails: { kind: "office", seats: 1, dayCount: 1 },
        })
        .where(eq(workspaceReservations.id, id))
    );
    const address = invitee("signed-in-history");
    await record(id, { contactAttends: false, invitees: [address] });
    const matched = await Effect.runPromise(fixtures.customerAccount());
    const unrelated = await Effect.runPromise(fixtures.customerAccount());
    const history = (accountId: typeof matched, email: string) =>
      run(
        CustomerInvitedReservationsService.use((service) =>
          service.load("en-US")
        ).pipe(
          Effect.provide(
            CustomerInvitedReservationsService.Default.pipe(
              Layer.provide(
                Layer.mergeAll(
                  WorkspaceReservationRepository.Default,
                  Layer.mock(CurrentCustomerAccount, {
                    requireActive: Effect.succeed({
                      ...testCustomerSession,
                      accountId,
                      email: reservationCustomerEmailSchema.make(email),
                    }),
                  }),
                  Layer.mock(CustomerAccountLinkRepository, {
                    find: () => Effect.succeed(null),
                  }),
                  Layer.mock(ReservationRecords, {
                    listByIds: () => Effect.succeed([]),
                  }),
                  Layer.mock(DotyposService, {
                    getCustomer: () => Effect.succeedNone,
                  }),
                  Layer.mock(ReservationAccessService, {})
                )
              )
            )
          )
        )
      );
    expect(await history(matched, address)).toMatchObject({
      current: [{ orderId: id, product: { kind: "office" } }],
      past: [],
    });
    expect(
      await history(unrelated, testEmailAddress("unrelated-history"))
    ).toEqual({
      current: [],
      past: [],
    });
  });

  test("drains more than one retention batch even when the oldest address fails", async () => {
    const first = await insertReservation();
    const rest = await insertReservation();
    await record(
      first,
      { contactAttends: false, invitees: [invitee("retention-provider-down")] },
      {
        accessEndsAt: Temporal.Instant.from("2027-01-01T23:00:00Z"),
      }
    );
    await record(
      rest,
      {
        contactAttends: false,
        invitees: Array.from({ length: 27 }, (_, index) =>
          invitee(`retention-${index}`)
        ),
      },
      {
        accessEndsAt: Temporal.Instant.from("2027-01-02T23:00:00Z"),
      }
    );
    const now = Temporal.Instant.from("2027-03-01T00:00:00Z");
    const purge = (at: Temporal.Instant, outage: boolean) =>
      run(
        ReservationInviteeRetention.use((retention) =>
          retention.purgeDue({ now: at, limit: 25 })
        ).pipe(
          Effect.provide(
            ReservationInviteeRetention.Default.pipe(
              Layer.provide(
                Layer.mergeAll(
                  Layer.mock(CustomerAccountSections, {}),
                  Layer.mock(CustomerDotyposAdapter, {
                    classifyExactEmailCustomers: (email) =>
                      outage && email === invitee("retention-provider-down")
                        ? Effect.fail(
                            new DotyposUnavailable({
                              operation: "findCustomer",
                              reason: "server",
                              message: "Synthetic provider outage",
                            })
                          )
                        : Effect.succeed({ kind: "not-found" }),
                  })
                )
              )
            )
          )
        )
      );

    expect(await purge(now, true)).toEqual({
      deleted: 27,
      reduced: 0,
      failed: 1,
    });
    expect(
      await run(
        ReservationInvitees.use((invitees) => invitees.listForReservation(rest))
      )
    ).toEqual([]);
    expect(await purge(now.add({ hours: 24 }), false)).toEqual({
      deleted: 1,
      reduced: 0,
      failed: 0,
    });
  });

  test("keeps a reduced row's customer link and deletes it with the account", async () => {
    const reservationId = await insertReservation();
    await record(reservationId, {
      contactAttends: false,
      invitees: [invitee("linked")],
    });
    const account = await Effect.runPromise(fixtures.customerAccount());
    const [row] = await run(
      ReservationInvitees.use((invitees) =>
        invitees.listForReservation(reservationId)
      )
    );
    if (!row) throw new Error("missing invitee row");

    await run(
      ReservationInvitees.use((invitees) =>
        invitees.reduceToCustomerLink({
          inviteeId: row.id,
          link: { customerAccountId: account },
        })
      )
    );
    const reduced = await run(
      ReservationInvitees.use((invitees) =>
        Effect.all({
          listed: invitees.listForReservation(reservationId),
          invited: invitees.findInvitedReservations({
            accountId: account,
            email: testEmailAddress("someone-else"),
          }),
        })
      )
    );
    expect(reduced.listed[0]?.email).toBeNull();
    expect(reduced.invited).toContain(reservationId);

    await run(
      ReservationInvitees.use((invitees) =>
        invitees.deleteForAccount({
          accountId: account,
          email: testEmailAddress("deleted-invitee"),
        })
      )
    );
    expect(
      await run(
        ReservationInvitees.use((invitees) =>
          invitees.listForReservation(reservationId)
        )
      )
    ).toEqual([]);
  });

  test("deletes a released hold's rows", async () => {
    const reservationId = await insertReservation({ reservation: "held" });
    await record(reservationId, {
      contactAttends: true,
      invitees: [invitee("released")],
    });
    await run(
      ReservationInvitees.use((invitees) =>
        invitees.deleteForReservation(reservationId)
      )
    );
    const rows = await Effect.runPromise(
      testDatabase.db
        .select({ id: reservationInvitees.id })
        .from(reservationInvitees)
        .where(eq(reservationInvitees.workspaceReservationId, reservationId))
    );
    expect(rows).toEqual([]);
    // The reservation row itself stays.
    const [reservation] = await Effect.runPromise(
      testDatabase.db
        .select({ id: workspaceReservations.id })
        .from(workspaceReservations)
        .where(eq(workspaceReservations.id, reservationId))
    );
    expect(reservation?.id).toBe(reservationId);
  });
});
