import {
  EmailConfigTag,
  type EmailSendError,
  EmailServiceTag,
} from "@deskohub/email";
import { addressesOnlyTestRecipients } from "@deskohub/email/backend/email-routing";
import type { EmailMessage } from "@deskohub/email/types/email.types";
import {
  deploymentResendRequestTimeouts,
  makeResendEmailAttempt,
} from "@deskohub/email-resend";
import { Context, Effect, Layer, Redacted } from "effect";
import { WorkspaceEmailLayer } from "@/shared/backend/config/email.config";

// Resend keeps the key for 24 hours. Leave a minute for dispatch latency.
export const resendNoticeReplayMinutes = 24 * 60 - 1;

export type InviteeNoticeEmail = EmailMessage & {
  readonly idempotencyKey: string;
  readonly attachments?: never;
};

export type PreparedInviteeNotice = {
  readonly identity: Redacted.Redacted<string>;
  readonly replayWindowMinutes: number;
  readonly send: Effect.Effect<void, EmailSendError>;
};

export class ReservationInviteeNoticeTransport extends Context.Service<
  ReservationInviteeNoticeTransport,
  { readonly prepare: (message: InviteeNoticeEmail) => PreparedInviteeNotice }
>()("@deskohub-workspace/ReservationInviteeNoticeTransport") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const config = yield* EmailConfigTag;
      const email = yield* EmailServiceTag;
      const apiKey = config.apiKey?.trim();
      const timeouts = yield* deploymentResendRequestTimeouts;
      const resend = apiKey
        ? makeResendEmailAttempt({ apiKey, timeouts })
        : undefined;

      return {
        prepare: (message: InviteeNoticeEmail) => {
          if (resend && !addressesOnlyTestRecipients(message)) {
            return {
              ...resend(message),
              replayWindowMinutes: resendNoticeReplayMinutes,
            };
          }
          return {
            identity: Redacted.make(JSON.stringify(["console", message])),
            replayWindowMinutes: 0,
            send: email
              .send({ ...message, sensitiveContent: true })
              .pipe(Effect.asVoid),
          };
        },
      };
    })
  ).pipe(Layer.provide(WorkspaceEmailLayer));
}
