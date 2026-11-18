import { Effect } from "effect";
import { ReservationInviteeRetention } from "@/features/reservation-invitees/backend/reservation-invitee-retention.service";
import { defineWorkspaceCron } from "@/shared/backend/service-route";

const inviteeRetentionBatchLimit = 25;

export const GET = defineWorkspaceCron({
  operation: "reservationInviteeRetentionCron",
  failureMessage: "Reservation invitee retention cleanup failed",
  input: () => ({
    now: Temporal.Now.instant(),
    limit: inviteeRetentionBatchLimit,
  }),
  run: (input) =>
    Effect.flatMap(ReservationInviteeRetention, (retention) =>
      retention.purgeDue(input)
    ).pipe(Effect.provide(ReservationInviteeRetention.Live)),
});
