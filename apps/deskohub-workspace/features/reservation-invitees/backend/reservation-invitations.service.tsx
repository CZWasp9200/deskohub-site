import { getCustomerDisplayName } from "@deskohub/dotypos";
import {
  EmailConfigTag,
  EmailServiceError,
} from "@deskohub/email/backend/service";
import { Context, Data, Effect, Layer, Match, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type {
  ReservationInviteeNoticeKind,
  RestoredInviteeAccess,
} from "@/db/schema/reservation-invitee-notices";
import type { OfficeInviteeEmailReservation } from "@/emails/_components/office-invitee-email-details";
import type { ReservationEmailPeople } from "@/emails/_components/reservation-email-details";
import {
  OfficeInvitationEmail,
  officeInvitationEmailSubject,
} from "@/emails/office-invitation";
import {
  OfficeInviteeCancellationEmail,
  officeInviteeCancellationEmailSubject,
} from "@/emails/office-invitee-cancellation";
import {
  OfficeInviteeRestorationEmail,
  officeInviteeRestorationEmailSubject,
} from "@/emails/office-invitee-restoration";
import { env } from "@/env";
import { isLocale, type Locale } from "@/features/i18n";
import type { InviteeEmail } from "@/features/office/office-people";
import { getReservationInvitationPath } from "@/features/reservation/backend/protected-reservation-path";
import {
  createReservationInvitationToken,
  type ReservationInvitationInvalid,
} from "@/features/reservation/backend/reservation-invitation-capability";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationDetails } from "@/features/reservation/backend/workspace-reservation.service";
import type { ReservationInviteeId } from "@/features/reservation-invitees/reservation-invitee";
import { getWorkspaceRuntimeCallbackOrigin } from "@/shared/backend/config/workspace-url.config";
import { renderWorkspaceEmail } from "@/shared/backend/email/render-react-email";
import { workspaceEmailRecipient } from "@/shared/backend/email/workspace-email-recipients";
import type { InviteeNoticeEmail } from "./reservation-invitee-notice-transport";
import {
  type BookedOfficePeople,
  getBookedPeopleQuery,
  type ReservationInvitee,
  ReservationInvitees,
} from "./reservation-invitees.service";

/** Why a booker's resend wasn't sent. */
export type InvitationResendRefusal =
  | { readonly reason: "not-found" }
  | { readonly reason: "not-confirmed" }
  | { readonly reason: "cooldown"; readonly retryAt: Temporal.Instant };

export class InvitationResendRefused extends Data.TaggedError(
  "InvitationResendRefused"
)<{ readonly refusal: InvitationResendRefusal }> {}

export interface IReservationInvitations {
  /**
   * Who is coming, as the booker's confirmation lists them; none for an
   * order booked without a people list.
   */
  readonly bookerPeople: (
    reservation: WorkspaceReservationDetails
  ) => Effect.Effect<Option.Option<ReservationEmailPeople>>;
  readonly renderNotice: (input: {
    readonly reservation: WorkspaceReservationDetails;
    readonly invitee: ReservationInvitee & { readonly email: InviteeEmail };
    readonly kind: ReservationInviteeNoticeKind;
    readonly noticeId: string;
    readonly restoredAccess?: RestoredInviteeAccess;
  }) => Effect.Effect<
    InviteeNoticeEmail,
    EmailServiceError | ReservationInvitationInvalid
  >;
}

const invitationSource = "workspace-reservation-invitation";

const getEmailLocale = (locale: string): Locale =>
  isLocale(locale) ? locale : "cs-CZ";

/** The booker's public display name in the invitation. */
const getBookerName = (reservation: WorkspaceReservationDetails) =>
  getCustomerDisplayName(reservation.customer) || "Deskohub Workspace";

export class ReservationInvitations extends Context.Service<
  ReservationInvitations,
  IReservationInvitations
>()("@deskohub-workspace/ReservationInvitations") {
  static Default = Layer.effect(
    ReservationInvitations,
    Effect.gen(function* () {
      const emailConfig = yield* EmailConfigTag;
      const invitees = yield* ReservationInvitees;
      const reservations = yield* WorkspaceReservationRepository;

      /** The stored order and who is coming to it, if it has a people list. */
      const loadBooked = (reservation: WorkspaceReservationDetails) =>
        reservations.findById(reservation.id).pipe(
          Effect.mapError(
            (cause) =>
              new EmailServiceError(
                "Workspace reservation could not be read for its invitees.",
                cause
              )
          ),
          Effect.flatMap((stored) =>
            stored === null || stored.officeContactAttends === null
              ? Effect.succeed(
                  Option.none<{
                    readonly stored: WorkspaceReservation;
                    readonly people: BookedOfficePeople;
                  }>()
                )
              : invitees
                  .findBookedPeople(getBookedPeopleQuery(stored))
                  .pipe(
                    Effect.map(Option.map((people) => ({ stored, people })))
                  )
          )
        );

      const inviteeReservation = (
        reservation: WorkspaceReservationDetails
      ): OfficeInviteeEmailReservation => ({
        reservedFrom: reservation.reservedFrom,
        reservedUntil: reservation.reservedUntil,
        bookedBy: getBookerName(reservation),
      });

      // Idempotent provider retries resend the same link, so the token is
      // a pure function of the invitee; anchor issuance at the reservation's
      // immutable start, as the booker's access link is.
      const createInvitationUrl = Effect.fn(
        "ReservationInvitations.createInvitationUrl"
      )(function* (
        reservation: WorkspaceReservationDetails,
        inviteeId: ReservationInviteeId,
        locale: Locale
      ) {
        const origin = yield* getWorkspaceRuntimeCallbackOrigin.pipe(
          Effect.mapError(
            (cause) =>
              new EmailServiceError(
                "Reservation invitation origin is unavailable.",
                cause
              )
          )
        );
        const invitationToken = yield* createReservationInvitationToken(
          { orderId: reservation.id, inviteeId, locale },
          { now: () => reservation.reservedFrom.epochMilliseconds }
        );
        return new URL(
          getReservationInvitationPath({
            locale,
            orderId: reservation.id,
            invitationToken,
            setBypassCookie: true,
          }),
          origin
        ).toString();
      });

      const render = (input: {
        readonly reservation: WorkspaceReservationDetails;
        readonly to: InviteeEmail;
        readonly category: string;
        readonly idempotencyKey: string;
        readonly element: React.ReactElement;
        readonly subject: string;
      }) =>
        renderWorkspaceEmail(input.element).pipe(
          Effect.map(
            (rendered): InviteeNoticeEmail => ({
              from: emailConfig.defaultFrom,
              to: { email: input.to },
              replyTo: workspaceEmailRecipient,
              subject: input.subject,
              html: rendered.html,
              text: rendered.text,
              tags: [input.category],
              idempotencyKey: input.idempotencyKey,
              sensitiveContent: true,
              metadata: {
                deploymentEnvironment: env.VERCEL_ENV,
                source: invitationSource,
                workspaceReservationId: input.reservation.id,
              },
            })
          )
        );

      return ReservationInvitations.of({
        bookerPeople: (reservation) =>
          loadBooked(reservation).pipe(
            Effect.map(
              Option.map(
                ({ people }): ReservationEmailPeople => ({
                  ...(people.contactAttends && {
                    contactName: getBookerName(reservation),
                  }),
                  invitees: people.invitees.map(({ email }) => email),
                })
              )
            ),
            Effect.tapError(() =>
              Effect.logWarning(
                "Reservation people for the booker unavailable",
                {
                  code: "reservation.invitation.people-failed",
                }
              )
            ),
            Effect.orElseSucceed(() => Option.none())
          ),
        renderNotice: Effect.fn("ReservationInvitations.renderNotice")(
          function* (input) {
            const { reservation, invitee, noticeId, restoredAccess } = input;
            const props = {
              locale: getEmailLocale(reservation.locale),
              reservation: inviteeReservation(reservation),
            };
            return yield* Match.value(input.kind).pipe(
              Match.when(
                "invitation",
                Effect.fnUntraced(function* () {
                  const invitation = {
                    ...props,
                    invitationUrl: yield* createInvitationUrl(
                      reservation,
                      invitee.id,
                      props.locale
                    ),
                  };
                  return yield* render({
                    reservation,
                    to: invitee.email,
                    category: "workspace-reservation-invitation",
                    idempotencyKey: `reservation-invitation:${noticeId}`,
                    element: <OfficeInvitationEmail {...invitation} />,
                    subject: officeInvitationEmailSubject(invitation),
                  });
                })
              ),
              Match.when("cancellation", () =>
                render({
                  reservation,
                  to: invitee.email,
                  category: "workspace-reservation-invitee-cancellation",
                  idempotencyKey: `reservation-invitee-cancelled:${noticeId}`,
                  element: <OfficeInviteeCancellationEmail {...props} />,
                  subject: officeInviteeCancellationEmailSubject(props),
                })
              ),
              Match.when(
                "restoration",
                Effect.fnUntraced(function* () {
                  const restored = {
                    ...props,
                    ...(restoredAccess &&
                      restoredAccess !== "past" && {
                        invitationUrl: yield* createInvitationUrl(
                          reservation,
                          invitee.id,
                          props.locale
                        ),
                        accessReissued: restoredAccess === "issued",
                      }),
                  };
                  return yield* render({
                    reservation,
                    to: invitee.email,
                    category: "workspace-reservation-invitee-restoration",
                    idempotencyKey: `reservation-invitee-restored:${noticeId}`,
                    element: <OfficeInviteeRestorationEmail {...restored} />,
                    subject: officeInviteeRestorationEmailSubject(props),
                  });
                })
              ),
              Match.exhaustive
            );
          }
        ),
      });
    })
  );

  /** The invitations over the live invitee and reservation stores. */
  static Live = ReservationInvitations.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        ReservationInvitees.Default,
        WorkspaceReservationRepository.Default.pipe(
          Layer.provide(WorkspaceDatabase.Default)
        )
      )
    )
  );
}
