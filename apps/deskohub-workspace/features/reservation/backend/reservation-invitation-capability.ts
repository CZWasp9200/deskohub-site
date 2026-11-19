import { createHash } from "node:crypto";
import { Data, Effect, Schema } from "effect";
import { type Locale, locales } from "@/features/i18n";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import {
  type ReservationInvitationToken,
  reservationInvitationTokenSchema,
} from "@/features/reservation/reservation-access-token";
import {
  type ReservationInviteeId,
  reservationInviteeIdSchema,
} from "@/features/reservation-invitees/reservation-invitee";
import { makeSignedClaims } from "@/shared/backend/signed-claims";
import {
  getReservationAccessTokenSecret,
  type ReservationAccessTokenOptions,
} from "./reservation-access-token";

// A person a booker invited opens the reservation's access page through
// their own invitation link. The link's token and the cookie the proxy
// exchanges it for name the invitee, so each stays valid only while the
// invitee's row exists; their purposes keep them from opening as a
// customer's access token or cookie, which see the whole order.

const invitationTokenPurpose = "reservation-invitation";
const invitationCookiePurpose = "reservation-invitation-cookie";
const invitationCookieNamePrefix = "__Host-deskohub-reservation-invitation-";
/** How long an exchanged invitation keeps the browser in, as access does. */
const invitationCookieMaxAgeMilliseconds = 24 * 60 * 60 * 1000;

const invitationClaimsFields = {
  orderId: workspaceReservationIdSchema,
  inviteeId: reservationInviteeIdSchema,
  locale: Schema.Literals(locales),
  issuedAtEpochMilliseconds: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
};

const invitationTokenClaims = makeSignedClaims({
  purpose: invitationTokenPurpose,
  schema: Schema.Struct({
    purpose: Schema.Literal(invitationTokenPurpose),
    ...invitationClaimsFields,
  }),
});

const invitationCookieClaims = makeSignedClaims({
  purpose: invitationCookiePurpose,
  schema: Schema.Struct({
    purpose: Schema.Literal(invitationCookiePurpose),
    ...invitationClaimsFields,
    expiresAtEpochMilliseconds: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(0)
    ),
  }),
});

/** An invitation link or cookie that doesn't open for this reservation. */
export class ReservationInvitationInvalid extends Data.TaggedError(
  "ReservationInvitationInvalid"
)<{ readonly message: string; readonly cause?: unknown }> {}

/** The invitee an opened invitation names. */
export interface ReservationInvitation {
  readonly orderId: WorkspaceReservationId;
  readonly inviteeId: ReservationInviteeId;
  readonly locale: Locale;
}

const secrets = (options: ReservationAccessTokenOptions) =>
  getReservationAccessTokenSecret(options).pipe(
    Effect.map((secret) => [secret] as const),
    Effect.mapError(
      (cause) =>
        new ReservationInvitationInvalid({
          message: "Reservation invitation secret is unavailable.",
          cause,
        })
    )
  );

/** The token of an invitee's personal link to the access page. */
export const createReservationInvitationToken = Effect.fn(
  "reservationInvitation.createToken"
)(function* (
  invitation: ReservationInvitation,
  options: ReservationAccessTokenOptions = {}
) {
  const [secret] = yield* secrets(options);
  const token = yield* invitationTokenClaims
    .sign(
      {
        purpose: invitationTokenPurpose,
        ...invitation,
        issuedAtEpochMilliseconds: options.now?.() ?? Date.now(),
      },
      [secret]
    )
    .pipe(
      Effect.mapError(
        (cause) =>
          new ReservationInvitationInvalid({
            message: "Reservation invitation claims are invalid.",
            cause,
          })
      )
    );
  return reservationInvitationTokenSchema.make(token);
});

const matching = (
  claims: ReservationInvitation,
  expected: { readonly orderId: WorkspaceReservationId }
): Effect.Effect<ReservationInvitation, ReservationInvitationInvalid> =>
  claims.orderId === expected.orderId
    ? Effect.succeed({
        orderId: claims.orderId,
        inviteeId: claims.inviteeId,
        locale: claims.locale,
      })
    : Effect.fail(
        new ReservationInvitationInvalid({
          message: "Reservation invitation is for another reservation.",
        })
      );

/** Opens an invitation link's token for the reservation and locale it opens. */
export const openReservationInvitationToken = Effect.fn(
  "reservationInvitation.openToken"
)(function* (
  input: {
    readonly token: ReservationInvitationToken;
    readonly orderId: WorkspaceReservationId;
    readonly locale: Locale;
  },
  options: ReservationAccessTokenOptions = {}
) {
  const claims = yield* invitationTokenClaims
    .open(input.token, secrets(options))
    .pipe(
      Effect.mapError(
        (cause) =>
          new ReservationInvitationInvalid({
            message: "Reservation invitation is invalid.",
            cause,
          })
      )
    );
  if (claims.locale !== input.locale) {
    return yield* new ReservationInvitationInvalid({
      message: "Reservation invitation is for another locale.",
    });
  }
  return yield* matching(claims, input);
});

/** The cookie that keeps an exchanged invitation for one reservation. */
export const getReservationInvitationCookieName = (
  orderId: WorkspaceReservationId
) =>
  `${invitationCookieNamePrefix}${createHash("sha256")
    .update(orderId)
    .digest("base64url")}`;

/** Writes the cookie an exchanged invitation keeps the browser in with. */
export const writeReservationInvitationCookie = Effect.fn(
  "reservationInvitation.writeCookie"
)(function* (
  store: {
    readonly set: (
      name: string,
      value: string,
      options: {
        readonly expires: Date;
        readonly httpOnly: true;
        readonly maxAge: number;
        readonly path: "/";
        readonly sameSite: "lax";
        readonly secure: true;
      }
    ) => void;
  },
  invitation: ReservationInvitation,
  options: ReservationAccessTokenOptions = {}
) {
  const [secret] = yield* secrets(options);
  const issuedAtEpochMilliseconds = options.now?.() ?? Date.now();
  const expiresAtEpochMilliseconds =
    issuedAtEpochMilliseconds + invitationCookieMaxAgeMilliseconds;
  const value = yield* invitationCookieClaims
    .sign(
      {
        purpose: invitationCookiePurpose,
        ...invitation,
        issuedAtEpochMilliseconds,
        expiresAtEpochMilliseconds,
      },
      [secret]
    )
    .pipe(
      Effect.mapError(
        (cause) =>
          new ReservationInvitationInvalid({
            message: "Reservation invitation cookie claims are invalid.",
            cause,
          })
      )
    );
  store.set(getReservationInvitationCookieName(invitation.orderId), value, {
    expires: new Date(expiresAtEpochMilliseconds),
    httpOnly: true,
    maxAge: invitationCookieMaxAgeMilliseconds / 1000,
    path: "/",
    sameSite: "lax",
    secure: true,
  });
});

/** Opens an invitation cookie for the reservation it was set for. */
export const openReservationInvitationCookie = Effect.fn(
  "reservationInvitation.openCookie"
)(function* (
  input: {
    readonly value: string;
    readonly orderId: WorkspaceReservationId;
  },
  options: ReservationAccessTokenOptions = {}
) {
  const claims = yield* invitationCookieClaims
    .open(input.value, secrets(options))
    .pipe(
      Effect.mapError(
        (cause) =>
          new ReservationInvitationInvalid({
            message: "Reservation invitation cookie is invalid.",
            cause,
          })
      )
    );
  const now = options.now?.() ?? Date.now();
  if (
    claims.expiresAtEpochMilliseconds <= now ||
    claims.expiresAtEpochMilliseconds - claims.issuedAtEpochMilliseconds >
      invitationCookieMaxAgeMilliseconds
  ) {
    return yield* new ReservationInvitationInvalid({
      message: "Reservation invitation cookie expired.",
    });
  }
  return yield* matching(claims, input);
});

/** The invitation cookie of one reservation in a request's cookies. */
export const readReservationInvitationCookie = (
  store: {
    readonly get: (name: string) => { readonly value: string } | undefined;
  },
  orderId: WorkspaceReservationId
) => store.get(getReservationInvitationCookieName(orderId))?.value;
