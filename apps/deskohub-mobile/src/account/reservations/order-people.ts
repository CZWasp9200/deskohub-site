import type {
  CustomerReservationInvitee,
  CustomerReservationInviteeId,
  CustomerReservationOrderId,
  CustomerReservationParty,
} from "@deskohub/workspace-customer-api";
import { Data, DateTime, Effect, Option } from "effect";
import { Atom } from "effect/reactivity";
import { CustomerApi } from "../../customer-api/customer-api.service";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import { customerWrite } from "../../customer-api/customer-request";

/**
 * Who the order's contact is to the signed-in account, from the order's row
 * in a fresh history read: the customer the account booked it for (named
 * when their name could be read), else the account itself ("You"). Unknown
 * without a fresh row: a saved row keeps no party, and a new order may not
 * be listed yet.
 */
export type OrderContact = Data.TaggedEnum<{
  You: Record<never, never>;
  Customer: { readonly name: Option.Option<string> };
  Unknown: Record<never, never>;
}>;
export const OrderContact = Data.taggedEnum<OrderContact>();

export const orderContactOf = (
  freshRow: Option.Option<{ readonly party?: CustomerReservationParty }>
): OrderContact =>
  Option.match(freshRow, {
    onNone: () => OrderContact.Unknown(),
    onSome: ({ party }) =>
      party?.kind === "booked-for"
        ? OrderContact.Customer({
            name: Option.fromNullishOr(party.customerName),
          })
        : OrderContact.You(),
  });

/** What asking for an invitation again came to. */
export type InvitationResend = Data.TaggedEnum<{
  /** Sent; the next resend opens at `availableAt` (ISO instant). */
  Sent: { readonly availableAt: string };
  /** Sent too recently: try again at `retryAt` when the server says. */
  TooSoon: { readonly retryAt: Option.Option<string> };
  /** The order isn't paid and confirmed, or the person is no longer listed. */
  Refused: Record<never, never>;
}>;
export const InvitationResend = Data.taggedEnum<InvitationResend>();

/**
 * Sends an invited person's access email again (POST
 * `/reservations/:orderId/invitees/:inviteeId/invitation`). The server
 * decides whether it may; a refusal is an answer, not a failure.
 */
export const resendInvitation = (
  orderId: CustomerReservationOrderId,
  inviteeId: CustomerReservationInviteeId
) =>
  Effect.service(CustomerApi).pipe(
    Effect.flatMap((api) =>
      api.reservations
        .resendInvitation({ params: { orderId, inviteeId } })
        .pipe(customerWrite)
    ),
    Effect.map(({ resendAvailableAt }) =>
      InvitationResend.Sent({ availableAt: resendAvailableAt })
    ),
    Effect.catchTags({
      CustomerInvitationResendRefused: ({ reason, retryAt }) =>
        Effect.succeed(
          reason === "cooldown"
            ? InvitationResend.TooSoon({
                retryAt: Option.fromUndefinedOr(retryAt),
              })
            : InvitationResend.Refused()
        ),
      CustomerReservationNotFound: () =>
        Effect.succeed(InvitationResend.Refused()),
    })
  );

/** Resend for one order's invited people, by the person's id. */
export const resendInvitationAtom = Atom.family(
  (orderId: CustomerReservationOrderId) =>
    customerDataRuntime.fn((inviteeId: CustomerReservationInviteeId) =>
      resendInvitation(orderId, inviteeId)
    )
);

/**
 * When an eligible person's Resend opens: the later of the server's
 * `resendAvailableAt` and a resend this screen made (`resentUntil`).
 */
export const inviteeResend = (
  resendable: boolean | undefined,
  invitee: Pick<CustomerReservationInvitee, "resendAvailableAt">,
  resentUntil: Option.Option<string>,
  now: DateTime.Utc
): Option.Option<{ readonly opensAt: Option.Option<DateTime.Utc> }> => {
  if (resendable !== true) return Option.none();
  const ahead = [Option.fromUndefinedOr(invitee.resendAvailableAt), resentUntil]
    .flatMap((at) => Option.toArray(Option.flatMap(at, DateTime.make)))
    .filter((at) => DateTime.isGreaterThan(at, now))
    .sort((a, b) => DateTime.toEpochMillis(b) - DateTime.toEpochMillis(a));
  return Option.some({ opensAt: Option.fromUndefinedOr(ahead[0]) });
};
