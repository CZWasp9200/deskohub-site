import { getCustomerDisplayName } from "@deskohub/dotypos";
import {
  EmailConfigTag,
  type EmailSendError,
  EmailServiceError,
  EmailServiceTag,
} from "@deskohub/email/backend/service";
import { Context, Data, Effect, Layer, Option, Schedule } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
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
import { getReservationInvitationPath } from "@/features/reservation/backend/protected-reservation-path";
import { createReservationInvitationToken } from "@/features/reservation/backend/reservation-invitation-capability";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationDetails } from "@/features/reservation/backend/workspace-reservation.service";
import type { ReservationInviteeId } from "@/features/reservation-invitees/reservation-invitee";
import { invitationResendCooldown } from "@/features/reservation-invitees/reservation-people-view";
import { getWorkspaceRuntimeCallbackOrigin } from "@/shared/backend/config/workspace-url.config";
import { renderWorkspaceEmail } from "@/shared/backend/email/render-react-email";
import { workspaceEmailRecipient } from "@/shared/backend/email/workspace-email-recipients";
import {
  type BookedOfficePeople,
  getBookedPeopleQuery,
  type ReservationInvitee,
  ReservationInviteeStorageError,
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
  /**
   * Sends each invitee of a confirmed office their first invitation, once:
   * a retried fulfillment skips the ones already sent, and each send's
   * idempotency key collapses a repeat into the first. A failure is logged
   * per invitee and never fails the booker's confirmation; the booker can
   * resend.
   */
  readonly sendAll: (
    reservation: WorkspaceReservationDetails
  ) => Effect.Effect<void>;
  /**
   * Sends one invitee their invitation again, at most once per cooldown,
   * while the order is confirmed.
   */
  readonly resend: (input: {
    readonly reservation: WorkspaceReservationDetails;
    readonly inviteeId: ReservationInviteeId;
  }) => Effect.Effect<
    {
      readonly invitationSentAt: Temporal.Instant;
      readonly resendAvailableAt: Temporal.Instant;
    },
    InvitationResendRefused | ReservationInviteeStorageError | EmailSendError
  >;
  /** Tells each invitee that staff cancelled the office. Never fails. */
  readonly notifyCancelled: (
    reservation: WorkspaceReservationDetails
  ) => Effect.Effect<void>;
  /** Tells each invitee that staff restored the office. Never fails. */
  readonly notifyRestored: (input: {
    readonly reservation: WorkspaceReservationDetails;
    readonly accessReissued: boolean;
    readonly cancelledAt?: Temporal.Instant;
  }) => Effect.Effect<void>;
}

const invitationSource = "workspace-reservation-invitation";

/** Retries a provider hiccup a few times before the send counts as failed. */
const sendRetry = Schedule.max([
  Schedule.exponential("500 millis"),
  Schedule.recurs(2),
]);

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
      const emailService = yield* EmailServiceTag;
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
        const origin = yield* getWorkspaceRuntimeCallbackOrigin;
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

      const send = (input: {
        readonly reservation: WorkspaceReservationDetails;
        readonly to: string;
        readonly category: string;
        readonly idempotencyKey?: string;
        readonly element: React.ReactElement;
        readonly subject: string;
      }) =>
        renderWorkspaceEmail(input.element).pipe(
          Effect.flatMap((rendered) =>
            emailService.send({
              from: emailConfig.defaultFrom,
              to: { email: input.to },
              replyTo: workspaceEmailRecipient,
              subject: input.subject,
              html: rendered.html,
              text: rendered.text,
              tags: [input.category],
              ...(input.idempotencyKey && {
                idempotencyKey: input.idempotencyKey,
              }),
              metadata: {
                deploymentEnvironment: env.VERCEL_ENV,
                source: invitationSource,
                workspaceReservationId: input.reservation.id,
              },
            })
          ),
          Effect.retry({ schedule: sendRetry }),
          Effect.asVoid
        );

      const sendInvitation = Effect.fn("ReservationInvitations.sendInvitation")(
        function* (
          reservation: WorkspaceReservationDetails,
          invitee: ReservationInvitee & { readonly email: string },
          sendCount: number
        ) {
          const locale = getEmailLocale(reservation.locale);
          const props = {
            locale,
            reservation: inviteeReservation(reservation),
            invitationUrl: yield* createInvitationUrl(
              reservation,
              invitee.id,
              locale
            ).pipe(
              Effect.mapError(
                (cause) =>
                  new EmailServiceError(
                    "Reservation invitation link could not be created.",
                    cause
                  )
              )
            ),
          };
          yield* send({
            reservation,
            to: invitee.email,
            category: "workspace-reservation-invitation",
            idempotencyKey: `reservation-invitation:${invitee.id}:${sendCount}`,
            element: <OfficeInvitationEmail {...props} />,
            subject: officeInvitationEmailSubject(props),
          });
        }
      );

      /** Runs `notify` for each invitee still holding an address. */
      const forEachInvitee = (
        reservation: WorkspaceReservationDetails,
        operation: string,
        notify: (
          invitee: ReservationInvitee & { readonly email: string }
        ) => Effect.Effect<void, unknown>
      ) =>
        invitees.listForReservation(reservation.id).pipe(
          Effect.flatMap((rows) =>
            Effect.forEach(
              rows.filter(
                (row): row is ReservationInvitee & { readonly email: string } =>
                  row.email !== null
              ),
              (invitee) =>
                notify(invitee).pipe(
                  Effect.tapError(() =>
                    Effect.logError("Reservation invitee email failed", {
                      code: "reservation.invitation.delivery-failed",
                      operation,
                    })
                  ),
                  Effect.ignore
                ),
              { discard: true }
            )
          ),
          Effect.tapError(() =>
            Effect.logError("Reservation invitees could not be read", {
              code: "reservation.invitation.list-failed",
              operation,
            })
          ),
          Effect.ignore,
          Effect.annotateLogs({ workspaceReservationId: reservation.id })
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
        sendAll: (reservation) =>
          forEachInvitee(reservation, "invitation", (invitee) =>
            invitee.invitationSendCount > 0
              ? Effect.void
              : sendInvitation(reservation, invitee, 1).pipe(
                  Effect.andThen(
                    invitees.markInvitationSent({
                      inviteeId: invitee.id,
                      sendCount: 1,
                      sentAt: Temporal.Now.instant(),
                    })
                  )
                )
          ),
        resend: Effect.fn("ReservationInvitations.resend")(function* ({
          reservation,
          inviteeId,
        }) {
          const stored = yield* reservations.findById(reservation.id).pipe(
            Effect.mapError(
              () =>
                new ReservationInviteeStorageError({
                  operation: "load",
                  message:
                    "Reservation state could not be read for the invitation.",
                })
            )
          );
          if (stored?.reservationState !== "confirmed") {
            return yield* new InvitationResendRefused({
              refusal: { reason: "not-confirmed" },
            });
          }
          const found = yield* invitees.find(reservation.id, inviteeId);
          if (Option.isNone(found) || found.value.email === null) {
            return yield* new InvitationResendRefused({
              refusal: { reason: "not-found" },
            });
          }
          const invitee = { ...found.value, email: found.value.email };
          const sentAt = Temporal.Now.instant();
          const claimed = yield* invitees.claimResend({
            inviteeId,
            sentAt,
            cooldown: invitationResendCooldown,
            previousSendCount: invitee.invitationSendCount,
          });
          if (Option.isNone(claimed)) {
            const latest = yield* invitees.find(reservation.id, inviteeId);
            if (Option.isNone(latest) || latest.value.email === null) {
              return yield* new InvitationResendRefused({
                refusal: { reason: "not-found" },
              });
            }
            return yield* new InvitationResendRefused({
              refusal: {
                reason: "cooldown",
                retryAt: (latest.value.lastInvitationSentAt ?? sentAt).add(
                  invitationResendCooldown
                ),
              },
            });
          }
          yield* sendInvitation(reservation, invitee, claimed.value).pipe(
            Effect.onError(() =>
              invitees
                .releaseFailedResend({
                  inviteeId,
                  sendCount: claimed.value,
                  sentAt,
                  previousSentAt: invitee.lastInvitationSentAt,
                })
                .pipe(
                  Effect.catch(() =>
                    Effect.logWarning(
                      "A failed invitation resend could not be released",
                      {
                        code: "reservation.invitation.release-failed",
                      }
                    )
                  )
                )
            )
          );
          return {
            invitationSentAt: sentAt,
            resendAvailableAt: sentAt.add(invitationResendCooldown),
          };
        }),
        notifyCancelled: Effect.fn("ReservationInvitations.notifyCancelled")(
          function* (reservation: WorkspaceReservationDetails) {
            const stored = yield* reservations
              .findById(reservation.id)
              .pipe(Effect.orElseSucceed(() => null));
            const cancelledAt = stored?.reservationCancelledAt;
            yield* forEachInvitee(reservation, "cancellation", (invitee) => {
              const props = {
                locale: getEmailLocale(reservation.locale),
                reservation: inviteeReservation(reservation),
              };
              return send({
                reservation,
                to: invitee.email,
                category: "workspace-reservation-invitee-cancellation",
                ...(cancelledAt && {
                  idempotencyKey: `reservation-invitee-cancelled:${invitee.id}:${cancelledAt.epochMilliseconds}`,
                }),
                element: <OfficeInviteeCancellationEmail {...props} />,
                subject: officeInviteeCancellationEmailSubject(props),
              });
            });
          }
        ),
        notifyRestored: ({ reservation, accessReissued, cancelledAt }) =>
          forEachInvitee(
            reservation,
            "restoration",
            Effect.fnUntraced(function* (
              invitee: ReservationInvitee & { readonly email: string }
            ) {
              const locale = getEmailLocale(reservation.locale);
              const props = {
                locale,
                reservation: inviteeReservation(reservation),
                ...(accessReissued && {
                  invitationUrl: yield* createInvitationUrl(
                    reservation,
                    invitee.id,
                    locale
                  ),
                }),
              };
              yield* send({
                reservation,
                to: invitee.email,
                category: "workspace-reservation-invitee-restoration",
                ...(cancelledAt && {
                  idempotencyKey: `reservation-invitee-restored:${invitee.id}:${cancelledAt.epochMilliseconds}`,
                }),
                element: <OfficeInviteeRestorationEmail {...props} />,
                subject: officeInviteeRestorationEmailSubject(props),
              });
            })
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
