import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { IgloohomeDeviceIdSchema } from "@deskohub/igloohome";
import { testEmailAddress } from "@deskohub/test-email";
import { NodeCrypto } from "@effect/platform-node";
import { eq } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { reservationInvitees, workspaceReservations } from "@/db/schema";
import {
  InviteeEmail,
  type ValidOfficePeople,
} from "@/features/office/office-people";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { ReservationAccessRepository } from "@/features/reservation-access/backend/reservation-access.repository";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import { syntheticSealedStateKeyRing } from "@/shared/testing/sealed-state-keys.test-utils";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { ReservationInviteeEmailKeys } from "./reservation-invitee-email-keys.service";
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

  afterAll(async () => {
    await testDatabase.pool.query(
      "delete from reservation_access_grants where workspace_reservation_id = any($1)",
      [reservationIds]
    );
    await testDatabase.pool.query(
      "delete from workspace_reservations where id = any($1)",
      [reservationIds]
    );
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
      expect.objectContaining({ paid: true, email: invitee("due") }),
    ]);
    expect(byReservation(rescheduled)).toEqual([]);
    expect(byReservation(abandoned)).toEqual([
      expect.objectContaining({ paid: false, email: null }),
    ]);
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
