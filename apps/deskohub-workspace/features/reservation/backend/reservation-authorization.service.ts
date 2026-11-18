import type { DotyposCustomerId } from "@deskohub/dotypos";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Option, Result } from "effect";
import type { SqlError } from "effect/sql";
import {
  type CustomerAccountAccessError,
  CustomerAccountReservationOwnership,
} from "@/features/account";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { Locale } from "@/features/i18n";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type {
  ReservationAccessToken,
  ReservationInvitationToken,
} from "@/features/reservation/reservation-access-token";
import {
  type ReservationInviteeStorageError,
  ReservationInvitees,
} from "@/features/reservation-invitees/backend/reservation-invitees.service";
import { ReviewSandbox } from "@/features/review-accounts";
import {
  openReservationAccessCookie,
  type ReservationAccessCookieOptions,
} from "./reservation-access-cookie";
import { openReservationAccessToken } from "./reservation-access-token";
import {
  openReservationInvitationCookie,
  openReservationInvitationToken,
} from "./reservation-invitation-capability";
import type { WorkspaceReservationDetailsMalformedError } from "./stored-reservation-details.server";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "./workspace-reservation.repository";

/** What a visitor may see of a reservation. */
type ReservationPermission =
  | "view-status"
  | "open-payment-page"
  | "retry-payment"
  | "view-access-code"
  | "view-invoice";

/**
 * Who may see what. The customer's emailed capability links, the access
 * cookie, and the account linked to the reservation's customer see
 * everything. The author's session sees the status and may open its unpaid
 * payment page again, so the door access code and the invoice stay with the
 * customer the reservation was booked for.
 */
const reservationAccessPolicy = {
  capability: [
    "view-status",
    "open-payment-page",
    "retry-payment",
    "view-access-code",
    "view-invoice",
  ],
  customer: [
    "view-status",
    "open-payment-page",
    "retry-payment",
    "view-access-code",
    "view-invoice",
  ],
  author: ["view-status", "open-payment-page", "retry-payment"],
  // A person the booker invited sees the door code and nothing else of the
  // order: no status, payment, invoice or other people.
  invitee: ["view-access-code"],
} as const satisfies Record<string, readonly ReservationPermission[]>;

/**
 * Whom a reservation page shows itself to: its customer (the emailed links,
 * the access cookie, the author or the linked account), or a person the
 * booker invited, who gets the guest view.
 */
export type ReservationViewer = "customer" | "invitee";

const grants = (
  grant: keyof typeof reservationAccessPolicy,
  permission: ReservationPermission
) =>
  (reservationAccessPolicy[grant] as readonly ReservationPermission[]).includes(
    permission
  );

export type ReservationAuthorizationInput = {
  readonly accessCookie?: string;
  readonly accessToken?: ReservationAccessToken;
  /** The invitation cookie an invited person's link was exchanged for. */
  readonly invitationCookie?: string;
  readonly invitationToken?: ReservationInvitationToken;
  readonly locale: Locale;
  readonly orderId: WorkspaceReservationId;
  readonly permission: ReservationPermission;
};

/**
 * The signed-in account, its customer link, the reservation, or the review
 * sandbox couldn't be read, so whether the visitor may see the reservation
 * is unknown.
 */
export class ReservationAuthorizationUnavailableError extends Data.TaggedError(
  "ReservationAuthorizationUnavailableError"
)<{
  readonly orderId: WorkspaceReservationId;
  readonly cause:
    | CustomerAccountAccessError
    | ReservationInviteeStorageError
    | EffectDrizzleQueryError
    | SqlError.SqlError
    | WorkspaceReservationDetailsMalformedError;
}> {}

export interface IReservationAuthorizationService {
  /** Denies the visitor whenever a read fails. */
  readonly isAuthorized: (
    input: ReservationAuthorizationInput
  ) => Effect.Effect<boolean>;
  /**
   * Decides like `isAuthorized`, but reports a failed account, customer link,
   * reservation, or review sandbox read instead of denying. A signed-out or
   * unlinked visitor is still denied.
   */
  readonly authorize: (
    input: ReservationAuthorizationInput
  ) => Effect.Effect<boolean, ReservationAuthorizationUnavailableError>;
  /**
   * Decides like `authorize`, and names whom the page shows itself to; none
   * for a visitor it denies.
   */
  readonly authorizeViewer: (
    input: ReservationAuthorizationInput
  ) => Effect.Effect<
    Option.Option<ReservationViewer>,
    ReservationAuthorizationUnavailableError
  >;
}

const capabilityIsValid = Effect.fn(
  "ReservationAuthorizationService.capabilityIsValid"
)(function* (
  input: ReservationAuthorizationInput,
  options: ReservationAccessCookieOptions = {}
) {
  if (input.accessCookie) {
    const cookie = yield* openReservationAccessCookie(
      { value: input.accessCookie, orderId: input.orderId },
      options
    ).pipe(Effect.result);
    if (Result.isSuccess(cookie)) return true;
  }

  if (input.accessToken) {
    const token = yield* openReservationAccessToken(
      {
        token: input.accessToken,
        orderId: input.orderId,
        locale: input.locale,
      },
      options
    ).pipe(Effect.result);
    if (Result.isSuccess(token)) return true;
  }

  return false;
});

/** The invitee an invitation cookie or link names, if one opens. */
const openedInvitation = Effect.fn(
  "ReservationAuthorizationService.openedInvitation"
)(function* (input: ReservationAuthorizationInput) {
  if (input.invitationCookie) {
    const cookie = yield* openReservationInvitationCookie({
      value: input.invitationCookie,
      orderId: input.orderId,
    }).pipe(Effect.option);
    if (Option.isSome(cookie)) return cookie;
  }
  if (input.invitationToken) {
    return yield* openReservationInvitationToken({
      token: input.invitationToken,
      orderId: input.orderId,
      locale: input.locale,
    }).pipe(Effect.option);
  }
  return Option.none();
});

/**
 * The visitor's account, or `None` for a signed-out, unverified, or unlinked
 * visitor. A failed read stays a failure.
 */
const unlessDenied = <A>(
  account: Effect.Effect<A, CustomerAccountAccessError>
) =>
  account.pipe(
    Effect.asSome,
    Effect.catchIf(
      (error) => error.reason !== "unavailable",
      () => Effect.succeedNone
    )
  );

export class ReservationAuthorizationService extends Context.Service<
  ReservationAuthorizationService,
  IReservationAuthorizationService
>()("@deskohub-workspace/reservation/ReservationAuthorizationService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const ownership = yield* CustomerAccountReservationOwnership;
      const reservations = yield* WorkspaceReservationRepository;
      const reviewSandbox = yield* ReviewSandbox;
      const invitees = yield* ReservationInvitees;

      /**
       * The active account sees the reservation as its author, or as the
       * signed-in account linked to the reservation's customer.
       */
      const isAuthorOrCustomerOf = Effect.fnUntraced(function* (
        accountId: CustomerAccountId,
        reservation: WorkspaceReservation,
        permission: ReservationPermission
      ) {
        if (
          grants("author", permission) &&
          reservation.authorAccountId === accountId
        ) {
          return true;
        }
        if (!grants("customer", permission)) return false;

        const account = yield* unlessDenied(ownership.resolve);
        return (
          Option.isSome(account) &&
          account.value.dotyposCustomerId ===
            (reservation.dotyposCustomerId as DotyposCustomerId)
        );
      });

      /**
       * Whether the visitor was invited: an invitation cookie or link whose
       * invitee is still on the reservation, or a signed-in account whose
       * verified email, account or Dotypos customer a row names.
       */
      const isInvitee = Effect.fnUntraced(function* (
        input: ReservationAuthorizationInput
      ) {
        if (!grants("invitee", input.permission)) return false;
        const invitation = yield* openedInvitation(input);
        if (Option.isSome(invitation)) {
          const invitee = yield* invitees.find(
            input.orderId,
            invitation.value.inviteeId
          );
          if (Option.isSome(invitee)) return true;
        }

        const account = yield* unlessDenied(ownership.activeAccount);
        if (Option.isNone(account)) return false;
        const linked = yield* unlessDenied(ownership.resolve);
        const invited = yield* invitees.findInvitedReservations({
          accountId: account.value.accountId,
          email: account.value.email,
          dotyposCustomerId: Option.match(linked, {
            onNone: () => null,
            onSome: (found) => found.dotyposCustomerId,
          }),
        });
        return invited.includes(input.orderId);
      });

      const decideCustomer = Effect.fnUntraced(function* (
        input: ReservationAuthorizationInput
      ) {
        if (
          grants("capability", input.permission) &&
          (yield* capabilityIsValid(input))
        ) {
          return true;
        }

        // Both account grants need an active signed-in account; only the
        // customer grant also needs the account's linked Dotypos customer.
        const accountId = yield* unlessDenied(ownership.activeAccountId);
        if (Option.isNone(accountId)) return false;

        const reservation = yield* reservations.findById(input.orderId);
        // A review account's sandbox order is the account's own booking, so
        // it sees what an author sees: the status, never an access code.
        if (!reservation) {
          return (
            grants("author", input.permission) &&
            (yield* reviewSandbox.isOrderOf({
              accountId: accountId.value,
              orderId: input.orderId,
            }))
          );
        }

        return yield* isAuthorOrCustomerOf(
          accountId.value,
          reservation,
          input.permission
        );
      });

      const decide = Effect.fnUntraced(function* (
        input: ReservationAuthorizationInput
      ) {
        if (yield* decideCustomer(input)) {
          return Option.some<ReservationViewer>("customer");
        }
        return (yield* isInvitee(input))
          ? Option.some<ReservationViewer>("invitee")
          : Option.none<ReservationViewer>();
      });

      const authorizeViewer = Effect.fn(
        "ReservationAuthorizationService.authorizeViewer"
      )((input: ReservationAuthorizationInput) =>
        decide(input).pipe(
          Effect.mapError(
            (cause) =>
              new ReservationAuthorizationUnavailableError({
                orderId: input.orderId,
                cause,
              })
          )
        )
      );

      const authorize = Effect.fn("ReservationAuthorizationService.authorize")(
        (input: ReservationAuthorizationInput) =>
          authorizeViewer(input).pipe(Effect.map(Option.isSome))
      );

      const isAuthorized = Effect.fn(
        "ReservationAuthorizationService.isAuthorized"
      )((input: ReservationAuthorizationInput) =>
        authorize(input).pipe(Effect.orElseSucceed(() => false))
      );

      return {
        isAuthorized,
        authorize,
        authorizeViewer,
      } satisfies IReservationAuthorizationService;
    })
  );

  /**
   * The service deciding for the account the `CustomerAuthentication` the
   * caller provides reads, such as the customer API's session.
   */
  static ForProvidedAuthentication = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CustomerAccountReservationOwnership.ForProvidedAuthentication,
        WorkspaceReservationRepository.Live,
        ReviewSandbox.Live,
        ReservationInvitees.Default
      )
    )
  );

  /** The service deciding for the browser session's account. */
  static Live = this.ForProvidedAuthentication.pipe(
    Layer.provide(CustomerAuthentication.Default)
  );
}
