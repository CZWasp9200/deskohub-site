import type { DotyposCustomerId } from "@deskohub/dotypos";
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
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
  reservationInviteeNotices,
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
interface InviteeViewer {
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
  /** Settles a provider acceptance and records an invitation send together. */
  readonly acceptNotice: (input: {
    readonly noticeId: string;
    readonly invitationRecipient?: ReservationInviteeId;
    readonly sentAt: Temporal.Instant;
  }) => Effect.Effect<boolean, ReservationInviteeStorageError>;
  readonly deleteForReservation: (
    reservationId: WorkspaceReservationId
  ) => Effect.Effect<void, ReservationInviteeStorageError>;
  /**
   * Rows due for the retention purge at `now`, at most `limit`: past the
   * later of `retain_until` and 30 Prague days after a rescheduled access
   * end. Never-paid released holds are due once they can no longer be
   * retried in place.
   */
  readonly listDue: (input: {
    readonly now: Temporal.Instant;
    readonly limit: number;
  }) => Effect.Effect<
    ReadonlyArray<DueReservationInvitee>,
    ReservationInviteeStorageError
  >;
  readonly deferRetention: (input: {
    readonly inviteeId: ReservationInviteeId;
    readonly retryAt: Temporal.Instant;
  }) => Effect.Effect<void, ReservationInviteeStorageError>;
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
export class ReservationInvitees extends Context.Service<
  ReservationInvitees,
  IReservationInvitees
>()("@deskohub-workspace/ReservationInvitees") {
  static Live = Layer.effect(
    ReservationInvitees,
    Effect.gen(function* () {
      const { db, transaction } = yield* WorkspaceDatabase;
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
        acceptNotice: ({ noticeId, invitationRecipient, sentAt }) =>
          transaction(
            Effect.gen(function* () {
              // Retention also writes the invitee before its notices.
              if (invitationRecipient) {
                yield* db
                  .update(reservationInvitees)
                  .set({
                    invitationSendCount: sql`${reservationInvitees.invitationSendCount} + 1`,
                    lastInvitationSentAt: sentAt,
                  })
                  .where(eq(reservationInvitees.id, invitationRecipient));
              }
              const [settled] = yield* db
                .update(reservationInviteeNotices)
                .set({ settledAt: sentAt })
                .where(
                  and(
                    eq(reservationInviteeNotices.id, noticeId),
                    isNull(reservationInviteeNotices.settledAt),
                    invitationRecipient
                      ? eq(
                          reservationInviteeNotices.inviteeId,
                          invitationRecipient
                        )
                      : undefined
                  )
                )
                .returning({ id: reservationInviteeNotices.id });
              if (!settled) {
                return yield* new ReservationInviteeStorageError({
                  operation: "write",
                  message: "The invitation notice is no longer pending.",
                });
              }
            })
          ).pipe(
            Effect.as(true),
            Effect.catchTag("ReservationInviteeStorageError", () =>
              Effect.succeed(false)
            ),
            Effect.mapError(
              storageError("write", "A guest notice could not be recorded.")
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
            const originalAccessEnd = sql`((${reservationInvitees.retainUntil} at time zone ${pragueTimeZone}) - make_interval(days => ${retentionDays})) at time zone ${pragueTimeZone}`;
            const rescheduledRetentionEnd = sql`((${reservationAccessGrants.accessEndsAt} at time zone ${pragueTimeZone}) + make_interval(days => ${retentionDays})) at time zone ${pragueTimeZone}`;
            const at = sql`${now.toString()}::timestamptz`;
            return yield* db
              .select({
                id: reservationInvitees.id,
                reservationId: reservationInvitees.workspaceReservationId,
                paid: sql<boolean>`(${paid})`,
              })
              .from(reservationInvitees)
              .innerJoin(
                workspaceReservations,
                eq(
                  reservationInvitees.workspaceReservationId,
                  workspaceReservations.id
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
                and(
                  isNotNull(reservationInvitees.keyId),
                  or(
                    isNull(reservationInvitees.retentionRetryAt),
                    lte(reservationInvitees.retentionRetryAt, now)
                  ),
                  or(
                    and(
                      paid,
                      sql`${at} >= greatest(${reservationInvitees.retainUntil}, ${rescheduledRetentionEnd})`
                    ),
                    and(
                      eq(workspaceReservations.reservationState, "draft"),
                      eq(workspaceReservations.paymentState, "not_started"),
                      isNull(workspaceReservations.reservationConfirmedAt),
                      lte(reservationInvitees.retainUntil, now)
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
                      or(
                        eq(workspaceReservations.paymentState, "not_started"),
                        sql`${at} >= ${originalAccessEnd}`
                      )
                    )
                  )
                )
              )
              .orderBy(
                asc(
                  sql`coalesce(${reservationInvitees.retentionRetryAt}, ${reservationInvitees.retainUntil})`
                ),
                asc(reservationInvitees.id)
              )
              .limit(limit);
          },
          Effect.mapError(
            storageError("load", "Due invitee rows could not be loaded.")
          )
        ),
        deferRetention: ({ inviteeId, retryAt }) =>
          db
            .update(reservationInvitees)
            .set({ retentionRetryAt: retryAt })
            .where(eq(reservationInvitees.id, inviteeId))
            .pipe(
              Effect.asVoid,
              Effect.mapError(
                storageError(
                  "write",
                  "Invitee retention retry could not be recorded."
                )
              )
            ),
        reduceToCustomerLink: ({ inviteeId, link }) =>
          transaction(
            Effect.gen(function* () {
              yield* db
                .update(reservationInvitees)
                .set({
                  ...link,
                  keyId: null,
                  encryptedEmail: null,
                  emailLookupKey: null,
                  retentionRetryAt: null,
                })
                .where(eq(reservationInvitees.id, inviteeId));
              yield* db
                .delete(reservationInviteeNotices)
                .where(eq(reservationInviteeNotices.inviteeId, inviteeId));
            })
          ).pipe(
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
