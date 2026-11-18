import { Data } from "effect";

export class CheckoutError extends Data.TaggedError("CheckoutError")<{
  readonly code:
    | "checkout_failed"
    | "meeting_room_reservation_ended"
    | "office_reservation_ended"
    | "cowork_reservation_ended"
    | "cowork_offer_replaced"
    | "legal_consent_required"
    | "early_performance_consent_required";
  readonly message: string;
  readonly cause?: unknown;
}> {}
