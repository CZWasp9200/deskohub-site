import { Match, Option } from "effect";
import type { ReservationVisit } from "@/features/reservation/backend/reservation-visits.service";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { AutomationTriggerKind } from "./automation-states";

/**
 * What a trigger's reservation visit says of it at `asOf` (§5.6, §5.9):
 * `current`, `withdrawn` because Dotypos cancelled the visit or no longer
 * returns it (D28), or `moved` because Dotypos moved the visit so the
 * trigger falls after `asOf`. Intake, replay and the pre-submit check each
 * pick their own `asOf` and name the verdict in their own terms.
 */
export type TriggeringVisitVerdict = "current" | "withdrawn" | "moved";

/** Whether a trigger of `kind` is re-checked against its reservation's live visit (D35). */
export const readsTriggeringVisit = (kind: AutomationTriggerKind): boolean =>
  Match.value(kind).pipe(
    Match.when(
      Match.is(
        "reservation-booked",
        "reservation-started",
        "reservation-finished"
      ),
      () => true
    ),
    Match.when(
      Match.is("reservation-cancelled", "schedule", "account-created"),
      () => false
    ),
    Match.exhaustive
  );

/**
 * Whether Workspace cancelling the triggering reservation after a trigger
 * of `kind` withdraws it (D28). A cancellation trigger is the cancellation
 * itself: a restore undoing it withdraws it instead
 * (`withdrawnByWorkspaceCancellation`). Schedule and account triggers have
 * no reservation.
 */
export const withdrawnByCancellation = (kind: AutomationTriggerKind): boolean =>
  Match.value(kind).pipe(
    Match.when(
      Match.is(
        "reservation-booked",
        "reservation-started",
        "reservation-finished"
      ),
      () => true
    ),
    Match.when(
      Match.is("reservation-cancelled", "schedule", "account-created"),
      () => false
    ),
    Match.exhaustive
  );

/**
 * When Workspace cancelled each reservation that is cancelled now. A
 * reservation that isn't, or that a restore uncancelled, is absent.
 */
export type WorkspaceCancellations = ReadonlyMap<
  WorkspaceReservationId,
  Temporal.Instant
>;

/**
 * Whether the triggering reservation's Workspace cancellation withdraws a
 * trigger (D28). A booked, started or finished trigger is withdrawn while
 * the reservation is cancelled. A cancellation trigger is withdrawn once
 * the reservation is no longer cancelled at the trigger's instant: a
 * restore undid that cancellation, and a later one is a trigger of its
 * own. Schedule and account triggers have no reservation.
 */
export const withdrawnByWorkspaceCancellation = (
  trigger: {
    readonly kind: AutomationTriggerKind;
    readonly at: Temporal.Instant;
    readonly reservationId: WorkspaceReservationId | null;
  },
  cancellations: WorkspaceCancellations
): boolean => {
  const cancelledAt = Option.fromUndefinedOr(
    trigger.reservationId === null
      ? undefined
      : cancellations.get(trigger.reservationId)
  );
  return Match.value(trigger.kind).pipe(
    Match.when(
      Match.is(
        "reservation-booked",
        "reservation-started",
        "reservation-finished"
      ),
      () => Option.isSome(cancelledAt)
    ),
    Match.when(
      "reservation-cancelled",
      () => !Option.exists(cancelledAt, (at) => at.equals(trigger.at))
    ),
    Match.when(Match.is("schedule", "account-created"), () => false),
    Match.exhaustive
  );
};

/**
 * When the visit reaches a trigger of `kind`: none for a booked trigger,
 * which needs only an active visit, and for kinds that read no visit.
 */
const triggeringMoment = (
  kind: AutomationTriggerKind,
  visit: ReservationVisit
): Option.Option<Temporal.Instant> =>
  Match.value(kind).pipe(
    Match.when("reservation-started", () => Option.some(visit.startsAt)),
    Match.when("reservation-finished", () => Option.some(visit.endsAt)),
    Match.when(
      Match.is(
        "reservation-booked",
        "reservation-cancelled",
        "schedule",
        "account-created"
      ),
      () => Option.none()
    ),
    Match.exhaustive
  );

/**
 * The trigger's verdict from its reservation's live visit. A booked,
 * started or finished trigger is withdrawn when the visit is cancelled or
 * gone; a started or finished one has moved while the visit's start or end
 * lies after `asOf`, the instant itself included as reached. Other kinds
 * read no visit and are always current.
 */
export const triggeringVisitVerdict = (input: {
  readonly kind: AutomationTriggerKind;
  readonly visit: Option.Option<ReservationVisit>;
  readonly asOf: Temporal.Instant;
}): TriggeringVisitVerdict => {
  if (!readsTriggeringVisit(input.kind)) return "current";
  return Option.match(
    Option.filter(input.visit, (visit) => visit.status === "active"),
    {
      onNone: () => "withdrawn",
      onSome: (visit) =>
        Option.exists(
          triggeringMoment(input.kind, visit),
          (reached) => Temporal.Instant.compare(reached, input.asOf) > 0
        )
          ? "moved"
          : "current",
    }
  );
};
