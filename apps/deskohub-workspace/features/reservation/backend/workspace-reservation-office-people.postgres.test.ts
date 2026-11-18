import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { asc, eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { reservationInvitees, workspaceReservations } from "@/db/schema";
import {
  checkoutAttemptKeySchema,
  checkoutSessionKeySchema,
} from "@/features/checkout/checkout-identifiers";
import { InviteeEmail } from "@/features/office/office-people";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { ReservationInviteeEmailKeys } from "@/features/reservation-invitees/backend/reservation-invitee-email-keys.service";
import { sealOfficePeople } from "@/features/reservation-invitees/backend/reservation-invitees.service";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import { syntheticSealedStateKeyRing } from "@/shared/testing/sealed-state-keys.test-utils";
import { fixtureReservationAuthorId } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type CreateWorkspaceReservationDraftInput,
  WorkspaceReservationRepository,
} from "./workspace-reservation.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const keys = ReservationInviteeEmailKeys.Live.pipe(
  Layer.provide(
    SealedStateKeys.fromConfiguration(
      syntheticSealedStateKeyRing(["office-people", 3])
    )
  )
);

const sealed = (contactAttends: boolean, ...localParts: string[]) =>
  Effect.runPromise(
    sealOfficePeople(
      {
        contactAttends,
        invitees: localParts.map((part) =>
          InviteeEmail.make(testEmailAddress(`office-people-${part}`))
        ),
      },
      Temporal.Instant.from("2030-03-05T23:00:00Z")
    ).pipe(Effect.provide(keys))
  );

const oldPeople = await sealed(true, "old");
const newPeople = await sealed(false, "new-a", "new-b");

describe.skipIf(!testDatabase)("Office people in the draft transaction", () => {
  if (!testDatabase) return;
  const reservationIds: WorkspaceReservationId[] = [];

  afterAll(async () => {
    await testDatabase.pool.query(
      "delete from workspace_reservations where id = any($1)",
      [reservationIds]
    );
  });

  const run = <A, E>(
    effect: Effect.Effect<A, E, WorkspaceReservationRepository>
  ) =>
    effect.pipe(
      Effect.provide(
        WorkspaceReservationRepository.Default.pipe(
          Layer.provide(testDatabase.layer)
        )
      ),
      Effect.runPromise
    );

  const draftInput = (
    officePeople?: CreateWorkspaceReservationDraftInput["officePeople"]
  ): CreateWorkspaceReservationDraftInput => {
    const checkoutSessionKey = checkoutSessionKeySchema.make(
      `session:${crypto.randomUUID()}`
    );
    const checkoutAttemptKey = checkoutAttemptKeySchema.make(
      `attempt:${crypto.randomUUID()}`
    );
    return {
      checkoutSessionKey,
      checkoutAttemptKey,
      dotyposCustomerId: DotyposCustomerIdSchema.make(
        `customer-${crypto.randomUUID()}`
      ),
      authorAccountId: fixtureReservationAuthorId,
      reservationPurpose: "personal",
      reservationDetails: { kind: "office", seats: 2, dayCount: 1 },
      locale: "en-US",
      checkoutSessionLockKey: BigInt(Math.floor(Math.random() * 2 ** 48)),
      acceptedCheckoutSessionKeys: [checkoutSessionKey],
      acceptedCheckoutAttemptKeys: [checkoutAttemptKey],
      ...(officePeople && { officePeople }),
    };
  };

  const stored = async (id: WorkspaceReservationId) => {
    const [reservation] = await Effect.runPromise(
      testDatabase.db
        .select({
          officeContactAttends: workspaceReservations.officeContactAttends,
        })
        .from(workspaceReservations)
        .where(eq(workspaceReservations.id, id))
    );
    const invitees = await Effect.runPromise(
      testDatabase.db
        .select({ position: reservationInvitees.position })
        .from(reservationInvitees)
        .where(eq(reservationInvitees.workspaceReservationId, id))
        .orderBy(asc(reservationInvitees.position))
    );
    return {
      contactAttends: reservation?.officeContactAttends,
      positions: invitees.map(({ position }) => position),
    };
  };

  test("records who is coming with the draft, once per attempt", async () => {
    const input = draftInput(await sealed(true, "first"));
    const draft = await run(
      WorkspaceReservationRepository.use((r) => r.createDraft(input))
    );
    reservationIds.push(draft.id);
    const replay = await run(
      WorkspaceReservationRepository.use((r) => r.createDraft(input))
    );

    expect(replay.id).toBe(draft.id);
    expect(await stored(draft.id)).toEqual({
      contactAttends: true,
      positions: [0],
    });
  });

  test("leaves the flag empty for a draft booked without people", async () => {
    const draft = await run(
      WorkspaceReservationRepository.use((r) => r.createDraft(draftInput()))
    );
    reservationIds.push(draft.id);

    expect(await stored(draft.id)).toEqual({
      contactAttends: null,
      positions: [],
    });
  });

  test("a superseding draft replaces the superseded draft's people", async () => {
    const superseded = await run(
      WorkspaceReservationRepository.use((r) =>
        r.createDraft(draftInput(oldPeople))
      )
    );
    reservationIds.push(superseded.id);
    await Effect.runPromise(
      testDatabase.db
        .update(workspaceReservations)
        .set({
          reservationState: "cancelling",
          dotyposReservationId: DotyposReservationIdSchema.make(
            `reservation-${crypto.randomUUID()}`
          ),
          cancellationCause: "checkout_superseded",
        })
        .where(eq(workspaceReservations.id, superseded.id))
    );

    const replacement = await run(
      WorkspaceReservationRepository.use((r) =>
        r.completeSupersessionAndCreateDraft({
          cancelledReservationId: superseded.id,
          cancelledAt: Temporal.Now.instant(),
          replacement: draftInput(newPeople),
        })
      )
    );
    reservationIds.push(replacement.id);

    expect(await stored(superseded.id)).toEqual({
      contactAttends: true,
      positions: [],
    });
    expect(await stored(replacement.id)).toEqual({
      contactAttends: false,
      positions: [0, 1],
    });
  });
});
