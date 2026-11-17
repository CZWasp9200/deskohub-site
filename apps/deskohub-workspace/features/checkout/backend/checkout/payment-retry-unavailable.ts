import { Data } from "effect";

/**
 * Preparing a payment retry could not read or write what it needs (the
 * payment provider, the reservation system, the database) or another run is
 * releasing the order's hold right now. Asking again may succeed.
 */
export class PaymentRetryUnavailableError extends Data.TaggedError(
  "PaymentRetryUnavailableError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
