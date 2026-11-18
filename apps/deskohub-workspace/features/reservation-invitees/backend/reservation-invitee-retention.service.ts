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
    if (!row.paid || row.email === null) return yield* remove;

    const account = yield* findActiveCustomerAccountByEmail(row.email).pipe(
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
      .classifyExactEmailCustomers(row.email)
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
    const due = yield* invitees.listDue(input);
    const outcomes = yield* Effect.forEach(
      due,
      (row) =>
        settle(row).pipe(
          Effect.catch(() =>
            Effect.logWarning("Reservation invitee retention row failed", {
              code: "reservation.invitee.retention-row-failed",
            }).pipe(Effect.as("failed" as const))
          )
        ),
      { concurrency: 4 }
    );
    return {
      deleted: outcomes.filter((outcome) => outcome === "deleted").length,
      reduced: outcomes.filter((outcome) => outcome === "reduced").length,
      failed: outcomes.filter((outcome) => outcome === "failed").length,
    };
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
