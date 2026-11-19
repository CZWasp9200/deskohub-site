import { Effect } from "effect";
import { ReservationInviteeNoticeWorker } from "@/features/reservation-invitees/backend/reservation-invitee-notice-worker";
import { defineWorkspaceCron } from "@/shared/backend/service-route";

export const maxDuration = 60;

export const GET = defineWorkspaceCron({
  operation: "reservationInviteeNoticesCron",
  failureMessage: "Reservation invitee notices could not be processed",
  input: () => ({ now: Temporal.Now.instant(), limit: 16 }),
  run: (input) =>
    Effect.flatMap(ReservationInviteeNoticeWorker, (worker) =>
      worker.drain(input)
    ).pipe(Effect.provide(ReservationInviteeNoticeWorker.Live)),
});
