import type { DotyposCustomerId } from "@deskohub/dotypos";
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import {
  Array as Arr,
  Context,
  Data,
  Effect,
  Layer,
  Option,
  Redacted,
} from "effect";
import { WorkspaceDatabase, WorkspaceTransaction } from "@/db/database.service";
import {
  reservationAccessGrants,
  reservationInvitees,
  workspaceReservations,
} from "@/db/schema";
import type { CustomerAccountId } from "@/features/account/customer-account";
import {
  getBookedOfficePeople,
  InviteeEmail,
  type ValidOfficePeople,
} from "@/features/office/office-people";
import type {
  StoredWorkspaceReservationDetails,
  WorkspaceReservationId,
} from "@/features/reservation/persistence-contracts";
import {
  getReservationInviteeRetainUntil,
  type ReservationInviteeId,
  type ReservationInviteeKeyId,
} from "@/features/reservation-invitees/reservation-invitee";
import { censorDatabaseQueryError } from "@/shared/backend/logging/censorship";
import {
  isUndecryptableSealedColumn,
  openSealedColumnText,
  sealColumnText,
} from "@/shared/backend/sealed-column";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { ReservationInviteeEmailKeys } from "./reservation-invitee-email-keys.service";

/**
 * Invitee rows that can't be read or written. Carries no address, key or
 * statement parameter.
 */
export class ReservationInviteeStorageError extends Data.TaggedError(
  "ReservationInviteeStorageError"
)<{
  readonly operation: "decrypt" | "key" | "load" | "write";
  readonly reservationId?: WorkspaceReservationId;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** One invitee as sealed for the insert that records it. */
interface SealedInvitee {
  readonly keyId: ReservationInviteeKeyId;
  readonly encryptedEmail: SQL<Buffer>;
  readonly emailLookupKey: string;
}

/**
 * Who is coming to an office, sealed for the draft transaction that records
 * it beside the reservation row: `contactAttends` goes on the reservation,
 * each invitee becomes a row.
 */
export interface SealedOfficePeople {
  readonly contactAttends: boolean;
  readonly retainUntil: Temporal.Instant;
  readonly invitees: ReadonlyArray<SealedInvitee>;
}

/**
 * Seals a validated people list under the active key. `accessEndsAt` is the
 * end of the office's last booked day; the address is kept 30 days past it.
 */
export const sealOfficePeople = Effect.fn("reservationInvitees.seal")(
  function* (people: ValidOfficePeople, accessEndsAt: Temporal.Instant) {
    const keys = yield* ReservationInviteeEmailKeys;
    const key = keys.active;
    return {
      contactAttends: people.contactAttends,
      retainUntil: getReservationInviteeRetainUntil(accessEndsAt),
      invitees: people.invitees.map(
        (email): SealedInvitee => ({
          keyId: key.id,
          encryptedEmail: sealColumnText(email, Redacted.value(key.passphrase)),
          emailLookupKey: keys.digest(key, email).digest,
        })
      ),
    } satisfies SealedOfficePeople;
  }
);

/**
 * Inserts a draft's invitee rows in the caller's transaction, in list order.
 * The statement binds the address and its key, so it runs untraced and a
 * failure leaves with its parameters censored.
 */
export const recordOfficeInvitees = Effect.fnUntraced(function* (
  reservationId: WorkspaceReservationId,
  people: SealedOfficePeople
) {
  if (people.invitees.length === 0) return;
  const { db } = yield* WorkspaceTransaction;
  yield* db
    .insert(reservationInvitees)
    .values(
      people.invitees.map((invitee, position) => ({
        workspaceReservationId: reservationId,
        position,
        keyId: invitee.keyId,
        encryptedEmail: invitee.encryptedEmail,
        emailLookupKey: invitee.emailLookupKey,
        retainUntil: people.retainUntil,
      }))
    )
    .pipe(
      Effect.withTracerEnabled(false),
      Effect.mapError(censorDatabaseQueryError)
    );
});

/** Deletes a reservation's invitee rows in the caller's transaction. */
export const deleteOfficeInvitees = Effect.fnUntraced(function* (
  reservationId: WorkspaceReservationId
) {
  const { db } = yield* WorkspaceTransaction;
  yield* db
    .delete(reservationInvitees)
    .where(eq(reservationInvitees.workspaceReservationId, reservationId));
});

/** An invitee of one reservation, address opened while it is kept. */
export interface ReservationInvitee {
  readonly id: ReservationInviteeId;
  readonly reservationId: WorkspaceReservationId;
  readonly position: number;
  /** Null once the retention purge reduced the row to a customer link. */
  readonly email: InviteeEmail | null;
  readonly lastInvitationSentAt: Temporal.Instant | null;
  readonly invitationSendCount: number;
}

/** Who is asking to see their invitations: a signed-in account. */
export interface InviteeViewer {
  readonly accountId: CustomerAccountId;
  /** The account's verified login email. */
  readonly email: string;
  readonly dotyposCustomerId?: DotyposCustomerId | null;
}

/** An invitee row the retention purge must settle. */
export interface DueReservationInvitee {
  readonly id: ReservationInviteeId;
  readonly reservationId: WorkspaceReservationId;
  /** False when the reservation was never paid: the row only goes. */
  readonly paid: boolean;
  readonly email: InviteeEmail | null;
}

/**
 * What `findBookedPeople` reads off a stored reservation: its stored
 * `office_contact_attends` and the seats its office snapshot booked.
 */
export const getBookedPeopleQuery = (reservation: {
  readonly id: WorkspaceReservationId;
  readonly officeContactAttends: boolean | null;
  readonly reservationDetails: StoredWorkspaceReservationDetails;
}) => ({
  id: reservation.id,
  officeContactAttends: reservation.officeContactAttends,
  seats:
    reservation.reservationDetails.kind === "office"
      ? reservation.reservationDetails.seats
      : undefined,
});

/** Who is coming to a booked office, as its booker sees them. */
export interface BookedOfficePeople {
  readonly contactAttends: boolean;
  readonly invitees: ReadonlyArray<
    ReservationInvitee & { readonly email: InviteeEmail }
  >;
}

export interface IReservationInvitees {
  /**
   * Who is coming to a reservation booked with a people list, from its
   * stored `office_contact_attends`, booked `seats` and invitee rows. None
   * for any other reservation, and once the retention purge reduced or
   * deleted an invitee (`getBookedOfficePeople`).
   */
  readonly findBookedPeople: (reservation: {
    readonly id: WorkspaceReservationId;
    readonly officeContactAttends: boolean | null;
    readonly seats: number | undefined;
  }) => Effect.Effect<
    Option.Option<BookedOfficePeople>,
    ReservationInviteeStorageError
  >;
  /** The reservation's invitees in list order, addresses opened. */
  readonly listForReservation: (
    reservationId: WorkspaceReservationId
  ) => Effect.Effect<
    ReadonlyArray<ReservationInvitee>,
    ReservationInviteeStorageError
  >;
  /** One invitee of a reservation, or none. */
  readonly find: (
    reservationId: WorkspaceReservationId,
    inviteeId: ReservationInviteeId
  ) => Effect.Effect<
    Option.Option<ReservationInvitee>,
    ReservationInviteeStorageError
  >;
  /** Whether a link still names an invitee whose address is retained. */
  readonly hasInvitation: (
    reservationId: WorkspaceReservationId,
    inviteeId: ReservationInviteeId
  ) => Effect.Effect<boolean, ReservationInviteeStorageError>;
  /**
   * The reservations that invited a signed-in account: rows whose address
   * digest matches its verified email under any configured key, and rows the
   * purge linked to the account or its Dotypos customer.
   */
  readonly findInvitedReservations: (
    viewer: InviteeViewer
  ) => Effect.Effect<
    ReadonlyArray<WorkspaceReservationId>,
    ReservationInviteeStorageError
  >;
  /**
   * Records an invitation sent as send number `sendCount`; a row already
   * past it stays as it is.
   */
  readonly markInvitationSent: (input: {
    readonly inviteeId: ReservationInviteeId;
    readonly sendCount: number;
    readonly sentAt: Temporal.Instant;
  }) => Effect.Effect<void, ReservationInviteeStorageError>;
  /**
   * Claims a resend: counts it and stamps `sentAt` only while the last send
   * is at least `cooldown` old. Returns the claimed send number, or none
   * while the cooldown runs.
   */
  readonly claimResend: (input: {
    readonly inviteeId: ReservationInviteeId;
    readonly sentAt: Temporal.Instant;
    readonly cooldown: Temporal.DurationLike;
    readonly previousSendCount: number;
  }) => Effect.Effect<Option.Option<number>, ReservationInviteeStorageError>;
  /** Releases precisely this failed resend, preserving a newer claim. */
  readonly releaseFailedResend: (input: {
    readonly inviteeId: ReservationInviteeId;
    readonly sendCount: number;
    readonly sentAt: Temporal.Instant;
    readonly previousSentAt: Temporal.Instant | null;
  }) => Effect.Effect<void, ReservationInviteeStorageError>;
  /** Deletes the reservation's rows, for a released hold. */
  readonly deleteForReservation: (
    reservationId: WorkspaceReservationId
  ) => Effect.Effect<void, ReservationInviteeStorageError>;
  /**
   * Rows due for the retention purge at `now`, at most `limit`: past the
   * later of `retain_until` and 30 Prague days after a rescheduled access
   * end, or of a reservation that was never paid and whose hold ended over
   * a week ago.
   */
  readonly listDue: (input: {
    readonly now: Temporal.Instant;
    readonly limit: number;
  }) => Effect.Effect<
    ReadonlyArray<DueReservationInvitee>,
    ReservationInviteeStorageError
  >;
  /** Clears a row's address, keeping the customer link that replaces it. */
  readonly reduceToCustomerLink: (input: {
    readonly inviteeId: ReservationInviteeId;
    readonly link:
      | { readonly customerAccountId: CustomerAccountId }
      | { readonly dotyposCustomerId: DotyposCustomerId };
  }) => Effect.Effect<void, ReservationInviteeStorageError>;
  readonly deleteRows: (
    inviteeIds: ReadonlyArray<ReservationInviteeId>
  ) => Effect.Effect<void, ReservationInviteeStorageError>;
  /**
   * Deletes the rows linked to a deleted account, by the account or its
   * Dotypos customer.
   */
  readonly deleteForAccount: (input: {
    readonly accountId: CustomerAccountId;
    readonly dotyposCustomerId?: DotyposCustomerId | null;
    readonly email: string;
  }) => Effect.Effect<void, ReservationInviteeStorageError>;
}

const storageError =
  (
    operation: ReservationInviteeStorageError["operation"],
    message: string,
    reservationId?: WorkspaceReservationId
  ) =>
  (cause: unknown) =>
    new ReservationInviteeStorageError({
      operation,
      message,
      ...(reservationId && { reservationId }),
      cause,
    });

const inviteeMetadata = {
  id: reservationInvitees.id,
  reservationId: reservationInvitees.workspaceReservationId,
  position: reservationInvitees.position,
  keyId: reservationInvitees.keyId,
  lastInvitationSentAt: reservationInvitees.lastInvitationSentAt,
  invitationSendCount: reservationInvitees.invitationSendCount,
};

type InviteeMetadata = {
  readonly id: ReservationInviteeId;
  readonly reservationId: WorkspaceReservationId;
  readonly position: number;
  readonly keyId: ReservationInviteeKeyId | null;
  readonly lastInvitationSentAt: Temporal.Instant | null;
  readonly invitationSendCount: number;
};

/** Days an address outlives a rescheduled access end, as at the write. */
const retentionDays = 30;
const pragueTimeZone = workspaceSiteConstants.location.timeZone;
/**
 * How long a never-paid order's people outlive its ended hold: a payment
 * retry books an expired or retried order again under the same id, so its
 * rows stay until retrying it is no longer plausible.
 */
const unpaidRetryWindow = { hours: 7 * 24 };

export class ReservationInvitees extends Context.Service<
  ReservationInvitees,
  IReservationInvitees
>()("@deskohub-workspace/ReservationInvitees") {
  static Live = Layer.effect(
    ReservationInvitees,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const keys = yield* ReservationInviteeEmailKeys;

      // Opens the addresses of rows already read, one untraced statement
      // per key that sealed any of them.
      const openAddresses = Effect.fnUntraced(function* (
        rows: ReadonlyArray<InviteeMetadata>,
        reservationId?: WorkspaceReservationId
      ) {
        const sealed = rows.filter(
          (row): row is InviteeMetadata & { keyId: ReservationInviteeKeyId } =>
            row.keyId !== null
        );
        const byKey = Arr.groupBy(sealed, (row) => row.keyId);
        const opened = new Map<ReservationInviteeId, InviteeEmail>();
        for (const [keyId, keyRows] of Object.entries(byKey)) {
          const key = yield* Effect.fromOption(
            keys.getById(keyId as ReservationInviteeKeyId)
          ).pipe(
            Effect.mapError(
              () =>
                new ReservationInviteeStorageError({
                  operation: "key",
                  message:
                    "An invitee address is sealed under a key that is no longer configured.",
                  ...(reservationId && { reservationId }),
                })
            )
          );
          const addresses = yield* db
            .select({
              id: reservationInvitees.id,
              email: openSealedColumnText(
                reservationInvitees.encryptedEmail,
                Redacted.value(key.passphrase)
              ),
            })
            .from(reservationInvitees)
            .where(
              inArray(
                reservationInvitees.id,
                keyRows.map((row) => row.id)
              )
            )
            .pipe(
              Effect.withTracerEnabled(false),
              Effect.mapError((error) =>
                isUndecryptableSealedColumn(error)
                  ? new ReservationInviteeStorageError({
                      operation: "decrypt",
                      message: "An invitee address could not be decrypted.",
                      ...(reservationId && { reservationId }),
                    })
                  : storageError(
                      "load",
                      "Invitee addresses could not be loaded.",
                      reservationId
                    )(censorDatabaseQueryError(error))
              )
            );
          for (const address of addresses) {
            opened.set(address.id, InviteeEmail.make(address.email));
          }
        }
        return rows.map(
          (row): ReservationInvitee => ({
            id: row.id,
            reservationId: row.reservationId,
            position: row.position,
            email: opened.get(row.id) ?? null,
            lastInvitationSentAt: row.lastInvitationSentAt,
            invitationSendCount: row.invitationSendCount,
          })
        );
      });

      const listWhere = (
        where: SQL | undefined,
        reservationId?: WorkspaceReservationId
      ) =>
        db
          .select(inviteeMetadata)
          .from(reservationInvitees)
          .where(where)
          .orderBy(
            asc(reservationInvitees.workspaceReservationId),
            asc(reservationInvitees.position)
          )
          .pipe(
            Effect.mapError(
              storageError(
                "load",
                "Invitee rows could not be loaded.",
                reservationId
              )
            ),
            Effect.flatMap((rows) => openAddresses(rows, reservationId))
          );

      const listForReservation = (reservationId: WorkspaceReservationId) =>
        listWhere(
          eq(reservationInvitees.workspaceReservationId, reservationId),
          reservationId
        );

      return ReservationInvitees.of({
        findBookedPeople: ({ id, officeContactAttends, seats }) =>
          officeContactAttends === null || seats === undefined
            ? Effect.succeed(Option.none())
            : listForReservation(id).pipe(
                Effect.map((invitees) =>
                  getBookedOfficePeople({
                    contactAttends: officeContactAttends,
                    seats,
                    invitees,
                  })
                )
              ),
        listForReservation: (reservationId) =>
          listWhere(
            eq(reservationInvitees.workspaceReservationId, reservationId),
            reservationId
          ),
        find: (reservationId, inviteeId) =>
          listWhere(
            and(
              eq(reservationInvitees.workspaceReservationId, reservationId),
              eq(reservationInvitees.id, inviteeId)
            ),
            reservationId
          ).pipe(Effect.map(Arr.head)),
        hasInvitation: (reservationId, inviteeId) =>
          db
            .select({ id: reservationInvitees.id })
            .from(reservationInvitees)
            .where(
              and(
                eq(reservationInvitees.workspaceReservationId, reservationId),
                eq(reservationInvitees.id, inviteeId),
                isNotNull(reservationInvitees.keyId)
              )
            )
            .limit(1)
            .pipe(
              Effect.map((rows) => rows.length > 0),
              Effect.mapError(
                storageError(
                  "load",
                  "Invitation could not be checked.",
                  reservationId
                )
              )
            ),
        findInvitedReservations: Effect.fn(
          "reservationInvitees.findInvitedReservations"
        )(function* (viewer) {
          const digests = keys
            .digests(InviteeEmail.make(viewer.email.trim().toLowerCase()))
            .map(({ digest }) => digest);
          const rows = yield* db
            .selectDistinct({
              reservationId: reservationInvitees.workspaceReservationId,
            })
            .from(reservationInvitees)
            .where(
              or(
                inArray(reservationInvitees.emailLookupKey, digests),
                eq(reservationInvitees.customerAccountId, viewer.accountId),
                ...(viewer.dotyposCustomerId
                  ? [
                      eq(
                        reservationInvitees.dotyposCustomerId,
                        viewer.dotyposCustomerId
                      ),
                    ]
                  : [])
              )
            )
            .pipe(
              Effect.withTracerEnabled(false),
              Effect.mapError((error) =>
                storageError(
                  "load",
                  "Invited reservations could not be loaded."
                )(censorDatabaseQueryError(error))
              )
            );
          return rows.map((row) => row.reservationId);
        }),
        markInvitationSent: ({ inviteeId, sendCount, sentAt }) =>
          db
            .update(reservationInvitees)
            .set({
              invitationSendCount: sendCount,
              lastInvitationSentAt: sentAt,
            })
            .where(
              and(
                eq(reservationInvitees.id, inviteeId),
                sql`${reservationInvitees.invitationSendCount} < ${sendCount}`
              )
            )
            .pipe(
              Effect.asVoid,
              Effect.mapError(
                storageError("write", "An invitation could not be recorded.")
              )
            ),
        claimResend: ({ inviteeId, sentAt, cooldown, previousSendCount }) =>
          db
            .update(reservationInvitees)
            .set({
              invitationSendCount: sql`${reservationInvitees.invitationSendCount} + 1`,
              lastInvitationSentAt: sentAt,
            })
            .where(
              and(
                eq(reservationInvitees.id, inviteeId),
                eq(reservationInvitees.invitationSendCount, previousSendCount),
                isNotNull(reservationInvitees.keyId),
                or(
                  sql`${reservationInvitees.lastInvitationSentAt} is null`,
                  sql`${reservationInvitees.lastInvitationSentAt} <= ${sentAt.subtract(cooldown).toString()}::timestamptz`
                )
              )
            )
            .returning({
              sendCount: reservationInvitees.invitationSendCount,
            })
            .pipe(
              Effect.map((rows) =>
                Option.map(Arr.head(rows), (row) => row.sendCount)
              ),
              Effect.mapError(
                storageError("write", "A resend could not be recorded.")
              )
            ),
        releaseFailedResend: ({
          inviteeId,
          sendCount,
          sentAt,
          previousSentAt,
        }) =>
          db
            .update(reservationInvitees)
            .set({
              invitationSendCount: sendCount - 1,
              lastInvitationSentAt: previousSentAt,
            })
            .where(
              and(
                eq(reservationInvitees.id, inviteeId),
                eq(reservationInvitees.invitationSendCount, sendCount),
                eq(reservationInvitees.lastInvitationSentAt, sentAt)
              )
            )
            .pipe(
              Effect.asVoid,
              Effect.mapError(
                storageError("write", "A failed resend could not be released.")
              )
            ),
        deleteForReservation: (reservationId) =>
          db
            .delete(reservationInvitees)
            .where(
              eq(reservationInvitees.workspaceReservationId, reservationId)
            )
            .pipe(
              Effect.asVoid,
              Effect.mapError(
                storageError(
                  "write",
                  "Invitee rows could not be deleted.",
                  reservationId
                )
              )
            ),
        listDue: Effect.fn("reservationInvitees.listDue")(
          function* ({ now, limit }) {
            const paid = or(
              eq(workspaceReservations.paymentState, "paid"),
              isNotNull(workspaceReservations.reservationConfirmedAt)
            );
            const pragueDays = (
              at: SQL | typeof reservationAccessGrants.accessEndsAt
            ) =>
              sql`((${at} at time zone ${pragueTimeZone}) + make_interval(days => ${retentionDays})) at time zone ${pragueTimeZone}`;
            const rows = yield* db
              .select({
                id: reservationInvitees.id,
                reservationId: reservationInvitees.workspaceReservationId,
                keyId: reservationInvitees.keyId,
                paid: sql<boolean>`(${paid})`,
              })
              .from(reservationInvitees)
              .innerJoin(
                workspaceReservations,
                eq(
                  workspaceReservations.id,
                  reservationInvitees.workspaceReservationId
                )
              )
              .leftJoin(
                reservationAccessGrants,
                eq(
                  reservationAccessGrants.workspaceReservationId,
                  workspaceReservations.id
                )
              )
              .where(
                or(
                  and(
                    paid,
                    isNotNull(reservationInvitees.keyId),
                    sql`${now.toString()}::timestamptz > greatest(${reservationInvitees.retainUntil}, coalesce(${pragueDays(reservationAccessGrants.accessEndsAt)}, ${reservationInvitees.retainUntil}))`
                  ),
                  and(
                    isNull(workspaceReservations.reservationConfirmedAt),
                    notInArray(workspaceReservations.paymentState, [
                      "paid",
                      "pending",
                    ]),
                    inArray(workspaceReservations.reservationState, [
                      "cancelled",
                      "hold_expired",
                    ]),
                    // A payment retry may still book the same order again
                    // for a while after its hold ended.
                    sql`coalesce(${workspaceReservations.reservationCancelledAt}, ${workspaceReservations.reservationHoldExpiredAt}, ${workspaceReservations.reservationHoldExpiresAt}) < ${now.subtract(unpaidRetryWindow).toString()}::timestamptz`
                  )
                )
              )
              .orderBy(asc(reservationInvitees.retainUntil))
              .limit(limit);
            const metadata = rows.map(
              (row): InviteeMetadata => ({
                id: row.id,
                reservationId: row.reservationId,
                position: 0,
                keyId: row.keyId,
                lastInvitationSentAt: null,
                invitationSendCount: 0,
              })
            );
            const paidRows = new Map(rows.map((row) => [row.id, row.paid]));
            // A never-paid row goes whatever it holds; only paid rows need
            // their address to look for a registered customer.
            const opened = yield* openAddresses(
              metadata.filter((row) => paidRows.get(row.id))
            );
            const emails = new Map(opened.map((row) => [row.id, row.email]));
            return metadata.map(
              (row): DueReservationInvitee => ({
                id: row.id,
                reservationId: row.reservationId,
                paid: paidRows.get(row.id) ?? false,
                email: emails.get(row.id) ?? null,
              })
            );
          },
          Effect.mapError((error) =>
            error instanceof ReservationInviteeStorageError
              ? error
              : storageError(
                  "load",
                  "Due invitee rows could not be loaded."
                )(error)
          )
        ),
        reduceToCustomerLink: ({ inviteeId, link }) =>
          db
            .update(reservationInvitees)
            .set({
              ...link,
              keyId: null,
              encryptedEmail: null,
              emailLookupKey: null,
            })
            .where(eq(reservationInvitees.id, inviteeId))
            .pipe(
              Effect.asVoid,
              Effect.mapError(
                storageError("write", "An invitee row could not be reduced.")
              )
            ),
        deleteRows: (inviteeIds) =>
          inviteeIds.length === 0
            ? Effect.void
            : db
                .delete(reservationInvitees)
                .where(inArray(reservationInvitees.id, [...inviteeIds]))
                .pipe(
                  Effect.asVoid,
                  Effect.mapError(
                    storageError("write", "Invitee rows could not be deleted.")
                  )
                ),
        deleteForAccount: ({ accountId, dotyposCustomerId, email }) =>
          db
            .delete(reservationInvitees)
            .where(
              or(
                eq(reservationInvitees.customerAccountId, accountId),
                inArray(
                  reservationInvitees.emailLookupKey,
                  keys
                    .digests(InviteeEmail.make(email.trim().toLowerCase()))
                    .map(({ digest }) => digest)
                ),
                ...(dotyposCustomerId
                  ? [
                      eq(
                        reservationInvitees.dotyposCustomerId,
                        dotyposCustomerId
                      ),
                    ]
                  : [])
              )
            )
            .pipe(
              Effect.asVoid,
              Effect.withTracerEnabled(false),
              Effect.mapError((error) =>
                storageError(
                  "write",
                  "A deleted account's invitee rows could not be deleted."
                )(censorDatabaseQueryError(error))
              )
            ),
      });
    })
  );

  static Default = ReservationInvitees.Live.pipe(
    Layer.provide(
      Layer.mergeAll(
        WorkspaceDatabase.Default,
        ReservationInviteeEmailKeys.Default
      )
    )
  );
}
