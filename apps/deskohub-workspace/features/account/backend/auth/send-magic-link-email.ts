import { type EmailMessage, EmailServiceTag } from "@deskohub/email";
import { type Config, Data, Effect, Layer, Predicate } from "effect";
import type { WorkspaceEmailLocale } from "@/emails/_components/workspace-email-layout";
import {
  EmailConfigLayer,
  workspaceDefaultFromAddress,
} from "@/shared/backend/config/email.config";
import { workspaceSiteConstants } from "@/shared/utils";
import {
  accountMagicLinkEmailCategoryTag,
  accountMagicLinkEmailSurface,
  isSyntheticE2EEmailRecipient,
  magicLinkPreviewE2ELogCode,
} from "./magic-link-policy";

/**
 * Account-owned transport failure. The original provider rejection is
 * deliberately not attached: the error must stay censored even if it escapes
 * delivery handling.
 */
export class MagicLinkDeliveryTransportError extends Data.TaggedError(
  "MagicLinkDeliveryTransportError"
)<{ readonly code: "account.magic-link.transport" }> {
  constructor() {
    super({ code: "account.magic-link.transport" });
  }
}

/**
 * Fixed, censored result codes for magic-link delivery. These are the only
 * delivery facts that may reach logs or telemetry: never the recipient, the
 * bearer URL, the token, the rendered body, or any provider payload.
 */
export type MagicLinkDeliveryCode =
  | "account.magic-link.delivery-accepted"
  | "account.magic-link.delivery-rejected"
  | "account.magic-link.delivery-failed"
  | "account.magic-link.delivery-unconfigured";

export type MagicLinkDeliveryRequest = {
  readonly email: string;
  readonly url: string;
  readonly locale: WorkspaceEmailLocale;
};

export type MagicLinkEmailRenderer = (
  request: MagicLinkDeliveryRequest
) => Effect.Effect<
  {
    readonly subject: string;
    readonly html: string;
    readonly text: string;
  },
  unknown
>;

export type MagicLinkDeliveryEnvironment = {
  readonly isVercelPreview: boolean;
};

/**
 * The shared email service picks the provider by recipient. Bearer content
 * reaches logs only for synthetic E2E recipients in Vercel Preview, after
 * Console accepted the message.
 */
const emitsPreviewE2ELine = (
  environment: MagicLinkDeliveryEnvironment,
  recipient: string,
  provider: string
) =>
  environment.isVercelPreview &&
  provider === "console" &&
  isSyntheticE2EEmailRecipient(recipient);

export const makeMagicLinkEmailDelivery = (
  render: MagicLinkEmailRenderer,
  environment: MagicLinkDeliveryEnvironment
): {
  readonly deliver: (
    request: MagicLinkDeliveryRequest
  ) => Effect.Effect<MagicLinkDeliveryCode>;
} => {
  const deliverRendered = Effect.fn("MagicLinkEmailDelivery.deliver")(
    function* (request: MagicLinkDeliveryRequest) {
      const rendered = yield* render(request).pipe(
        Effect.tapError(() =>
          Effect.logWarning("Magic-link email delivery failed.", {
            code: "account.magic-link.delivery-failed",
          })
        ),
        Effect.orElseSucceed(() => null)
      );
      if (!rendered) return "account.magic-link.delivery-failed" as const;

      const email = yield* EmailServiceTag;
      const sent = yield* email
        .send(magicLinkEmailMessage(request, rendered))
        .pipe(
          // Discard transport details after shared retries are exhausted.
          Effect.catchTag("NetworkError", () =>
            Effect.fail(new MagicLinkDeliveryTransportError())
          ),
          Effect.catchTag(
            "EmailDeliveryUnconfiguredError",
            unconfiguredDelivery
          ),
          Effect.catchTag("EmailServiceError", () =>
            Effect.logWarning(
              "Magic-link email was rejected by the provider.",
              {
                code: "account.magic-link.delivery-rejected",
              }
            ).pipe(Effect.as("account.magic-link.delivery-rejected" as const))
          )
        );
      if (Predicate.isString(sent)) return sent;

      // The synthetic Preview recipient is the only bearer-log exception.
      if (emitsPreviewE2ELine(environment, request.email, sent.provider)) {
        emitPreviewE2EConsoleDelivery(request.email, rendered.text);
      }

      yield* Effect.logInfo("Magic-link email accepted for delivery.", {
        code: "account.magic-link.delivery-accepted",
      });
      return "account.magic-link.delivery-accepted" as const;
    }
  );

  const deliver = Effect.fn("account.magic-link.deliver")(function* (
    request: MagicLinkDeliveryRequest
  ) {
    return yield* deliverRendered(request).pipe(
      Effect.provide(magicLinkEmailServiceLayer),
      // Keep transport and configuration failures within the fixed code
      // contract.
      Effect.catch(
        (error: Config.ConfigError | MagicLinkDeliveryTransportError) =>
          error._tag === "MagicLinkDeliveryTransportError"
            ? Effect.logWarning("Magic-link email delivery failed.", {
                code: "account.magic-link.delivery-failed",
              }).pipe(Effect.as("account.magic-link.delivery-failed" as const))
            : unconfiguredDelivery()
      )
    );
  });

  return { deliver };
};

const magicLinkSender = {
  email: workspaceDefaultFromAddress,
  name: workspaceSiteConstants.brand.name,
} as const;

const magicLinkEmailMessage = (
  request: MagicLinkDeliveryRequest,
  rendered: {
    readonly subject: string;
    readonly html: string;
    readonly text: string;
  }
): EmailMessage => ({
  from: magicLinkSender,
  to: { email: request.email },
  subject: rendered.subject,
  html: rendered.html,
  text: rendered.text,
  tags: [accountMagicLinkEmailCategoryTag],
  metadata: { surface: accountMagicLinkEmailSurface },
  sensitiveContent: true,
});

const unconfiguredDelivery = (): Effect.Effect<
  "account.magic-link.delivery-unconfigured",
  never,
  never
> =>
  Effect.logWarning("Magic-link delivery has no configured email provider.", {
    code: "account.magic-link.delivery-unconfigured",
  }).pipe(Effect.as("account.magic-link.delivery-unconfigured" as const));

const magicLinkEmailServiceLayer = EmailServiceTag.RecipientRouted.pipe(
  Layer.provide(EmailConfigLayer)
);

/**
 * Emits the sole approved bearer-link line for synthetic protected Preview
 * runs.
 */
const emitPreviewE2EConsoleDelivery = (recipient: string, text: string) => {
  // biome-ignore lint/suspicious/noConsole: Explicitly authorized preview E2E link delivery channel
  console.log(
    JSON.stringify({
      code: magicLinkPreviewE2ELogCode,
      recipient,
      message: "Synthetic preview magic-link text body for E2E retrieval.",
      text,
    })
  );
};
