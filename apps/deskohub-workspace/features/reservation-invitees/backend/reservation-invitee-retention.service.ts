import { Context, Effect, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { ensureCustomerAccount } from "@/features/account/backend/customer-account.repository";
import { findActiveCustomerAccountByEmail } from "@/features/account/backend/customer-account-by-email";
import { CustomerAccountSections } from "@/features/account/backend/customer-account-sections";
import { CustomerDotyposAdapter } from "@/features/account/backend/customer-dotypos-adapter.service";
import type { CustomerAccountAccessError } from "@/features/account/customer-account";
import {
  type DueReservationInvitee,
  type ReservationInviteeStorageError,
  ReservationInvitees,
} from "./reservation-invitees.service";

const makeRetention = Effect.gen(function* () {
  const invitees = yield* ReservationInvitees;
  const dotypos = yield* CustomerDotyposAdapter;
  const sections = yield* CustomerAccountSections;
  const database = yield* WorkspaceDatabase;

  const settle = Effect.fnUntraced(function* (row: DueReservationInvitee) {
    const remove = invitees
      .deleteRows([row.id])
      .pipe(Effect.as("deleted" as const));
    if (!row.paid) return yield* remove;

    const found = yield* invitees.find(row.reservationId, row.id);
    const email = Option.getOrUndefined(found)?.email;
    if (!email) return "gone";

    const account = yield* findActiveCustomerAccountByEmail(email).pipe(
      Effect.provideService(WorkspaceDatabase, database)
    );
    if (Option.isSome(account)) {
      const customerAccountId = account.value.accountId;
      return yield* sections
        .withActiveAccount(
          customerAccountId,
          ensureCustomerAccount(customerAccountId).pipe(
            Effect.provideService(WorkspaceDatabase, database),
            Effect.andThen(
              invitees.reduceToCustomerLink({
                inviteeId: row.id,
                link: { customerAccountId },
              })
            ),
            Effect.as("reduced" as const)
          ),
          { recheck: "active" }
        )
        .pipe(
          Effect.catchTag(
            "CustomerAccountAccessError",
            (
              failure
            ): Effect.Effect<
              "deleted",
              CustomerAccountAccessError | ReservationInviteeStorageError
            > =>
              failure.reason === "unauthenticated" ||
              failure.linkReason === "deletion-requested"
                ? remove
                : Effect.fail(failure)
          )
        );
    }

    const match = yield* dotypos
      .classifyExactEmailCustomers(email)
      .pipe(Effect.withTracerEnabled(false));
    if (match.kind !== "matched") return yield* remove;
    yield* invitees.reduceToCustomerLink({
      inviteeId: row.id,
      link: { dotyposCustomerId: match.customerId },
    });
    return "reduced" as const;
  });

  const purgeDue = Effect.fn("reservationInvitees.purgeDue")(function* (
    input: Parameters<typeof invitees.listDue>[0]
  ) {
    const deadline = Date.now() + 45_000;
    const counts = { deleted: 0, reduced: 0, failed: 0 };
    const retryAt = input.now.add({ hours: 6 });
    const processRow = (row: DueReservationInvitee) =>
      Effect.suspend(() => {
        const remaining = deadline - Date.now();
        return remaining <= 0
          ? Effect.succeed("gone" as const)
          : settle(row).pipe(Effect.timeout(Math.min(remaining, 35_000)));
      }).pipe(
        Effect.catch(() =>
          invitees.deferRetention({ inviteeId: row.id, retryAt }).pipe(
            Effect.tap(() =>
              Effect.logWarning("Reservation invitee retention row deferred", {
                code: "reservation.invitee.retention-row-failed",
              })
            ),
            Effect.as("failed" as const)
          )
        )
      );

    // A settled row leaves the query. A failed one stays due for a later
    // sweep and moves behind untouched rows even when that retry comes due.
    for (let batch = 0; batch < 8; batch++) {
      const due = yield* invitees.listDue(input);
      const outcomes = yield* Effect.forEach(due, processRow, {
        concurrency: 4,
      });
      for (const outcome of outcomes) {
        if (outcome !== "gone") counts[outcome]++;
      }
      if (due.length < input.limit || Date.now() >= deadline) break;
    }
    return counts;
  });
  return { purgeDue };
});

export class ReservationInviteeRetention extends Context.Service<
  ReservationInviteeRetention,
  Effect.Success<typeof makeRetention>
>()("@deskohub-workspace/ReservationInviteeRetention") {
  static Default = Layer.effect(this, makeRetention);

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        ReservationInvitees.Default,
        CustomerDotyposAdapter.Live,
        CustomerAccountSections.Live,
        WorkspaceDatabase.Default
      )
    )
  );
}
