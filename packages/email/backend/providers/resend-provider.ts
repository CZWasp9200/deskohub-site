import { type Duration, Effect, Layer, Schema } from "effect";
import { Resend } from "resend";
import {
  EmailDeliveryIdSchema,
  type EmailMessage,
  type EmailSendResult,
} from "../../types/email.types";
import {
  EmailConfigTag,
  type EmailProvider,
  EmailProviderTag,
  EmailServiceError,
  isRetryableEmailError,
} from "../capabilities";
import { NetworkError } from "../network-error";

const resendTagPattern = /^[A-Za-z0-9_-]{1,256}$/;
const resendSendTimeout = "5 seconds";
/** A batch carries up to 100 rendered emails, so its upload takes longer. */
const resendBatchSendTimeout = "20 seconds";

const toResendTags = (message: EmailMessage) => {
  const tags: { name: string; value: string }[] = [];

  for (const tag of message.tags ?? []) {
    if (resendTagPattern.test(tag)) {
      tags.push({ name: "category", value: tag });
    }
  }

  for (const [name, value] of Object.entries(message.metadata ?? {})) {
    if (typeof value !== "string") continue;
    if (!resendTagPattern.test(name) || !resendTagPattern.test(value)) continue;
    tags.push({ name, value });
  }

  return tags.length > 0 ? tags : undefined;
};

const getResendErrorMessage = (error: unknown) => {
  if (!error || typeof error !== "object") return "Unknown Resend error";

  const message = "message" in error ? error.message : undefined;
  if (typeof message === "string") return message;

  const code = "error" in error ? error.error : undefined;
  return typeof code === "string" ? code : "Unknown Resend error";
};

const getResendErrorStatusCode = (error: unknown) => {
  if (!error || typeof error !== "object" || !("statusCode" in error)) {
    return undefined;
  }

  return typeof error.statusCode === "number" ? error.statusCode : undefined;
};

type ResendResponse<A> = {
  readonly data: A | null;
  readonly error: unknown;
};

/**
 * Runs one Resend request and classifies its failure: a 4xx or an invalid
 * request is a rejection, anything else is a transport failure the caller may
 * retry under the same idempotency key. The raw provider failure is
 * discarded so spans and logs never carry its message.
 */
const requestResend = <A>(
  request: () => Promise<ResendResponse<A>>,
  timeout: Duration.Input
) =>
  Effect.tryPromise({
    try: async () => {
      const response = await request();
      const resendError = response.error;
      if (resendError) {
        const errorMessage = getResendErrorMessage(resendError);
        const statusCode = getResendErrorStatusCode(resendError);
        const normalizedErrorMessage = errorMessage.toLowerCase();

        if (
          (statusCode !== undefined && statusCode >= 400 && statusCode < 500) ||
          normalizedErrorMessage.includes("invalid") ||
          normalizedErrorMessage.includes("bad request") ||
          normalizedErrorMessage.includes("unauthorized") ||
          normalizedErrorMessage.includes("forbidden") ||
          normalizedErrorMessage.includes("not verified")
        ) {
          throw new Error(`CLIENT_ERROR: ${errorMessage}`);
        }

        throw new Error(`API_ERROR: ${errorMessage}`);
      }

      return response.data;
    },
    catch: (error) => {
      // Classify internally, then discard the raw provider failure.
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const normalizedErrorMessage = errorMessage.toLowerCase();

      if (errorMessage.includes("CLIENT_ERROR:")) {
        return new EmailServiceError(
          "Resend rejected the email request",
          undefined,
          "resend"
        );
      }

      if (
        errorMessage.includes("API_ERROR:") ||
        normalizedErrorMessage.includes("econnrefused") ||
        normalizedErrorMessage.includes("etimedout") ||
        normalizedErrorMessage.includes("enotfound") ||
        normalizedErrorMessage.includes("network")
      ) {
        return new NetworkError({
          message: "Resend network error",
        });
      }

      return new EmailServiceError(
        "Resend email send failed",
        undefined,
        "resend"
      );
    },
  }).pipe(
    Effect.timeoutOrElse({
      duration: timeout,
      orElse: () =>
        Effect.fail(
          new NetworkError({
            message: "Resend send timed out",
          })
        ),
    }),
    Effect.tapError((error) =>
      Effect.logWarning(
        "Resend tryPromise failed - will retry if NetworkError",
        {
          errorTag: error._tag,
          willRetry: isRetryableEmailError(error),
        }
      )
    )
  );

const toResendEmail = (message: EmailMessage) => ({
  from: `${message.from.name || ""} <${message.from.email}>`.trim(),
  to: Array.isArray(message.to)
    ? message.to.map((r) => r.email)
    : [message.to.email],
  subject: message.subject,
  html: message.html,
  text: message.text || "",
  replyTo: message.replyTo?.email,
  headers: message.headers,
  tags: toResendTags(message),
});

const decodeDeliveryId = (id: unknown) =>
  Schema.decodeUnknownEffect(EmailDeliveryIdSchema)(id).pipe(
    Effect.mapError(
      () =>
        new EmailServiceError(
          "Resend response did not contain a valid email delivery ID",
          undefined,
          "resend"
        )
    )
  );

export const createResendProvider = (apiKey: string): EmailProvider => {
  const resend = new Resend(apiKey);

  return {
    name: "resend",

    send: Effect.fn("resend.send")(
      function* (message: EmailMessage) {
        yield* Effect.logInfo("Sending email via Resend", {
          category: message.tags?.[0],
          hasHtml: !!message.html,
          hasText: !!message.text,
        });

        const data = yield* requestResend(
          () =>
            resend.emails.send(
              {
                ...toResendEmail(message),
                attachments: message.attachments?.map((attachment) => ({
                  content: attachment.content,
                  contentId: attachment.contentId,
                  contentType: attachment.contentType,
                  filename: attachment.filename,
                })),
              },
              {
                idempotencyKey: getResendIdempotencyKey(message.idempotencyKey),
              }
            ),
          resendSendTimeout
        ).pipe(
          Effect.tap((response) =>
            Effect.logInfo("Resend tryPromise succeeded", {
              hasData: !!response,
              id: response?.id,
            })
          )
        );

        const deliveryId = yield* decodeDeliveryId(data?.id);

        const sendResult: EmailSendResult = {
          id: deliveryId,
          status: "sent",
          provider: "resend",
          timestamp: new Date(),
        };

        yield* Effect.annotateLogsScoped({ result: sendResult });
        yield* Effect.logInfo("Email sent successfully via Resend", {
          id: data?.id,
        });

        return sendResult;
      },
      (effect, message) =>
        effect.pipe(
          Effect.scoped,
          Effect.annotateLogs({
            provider: "resend",
            category: message.tags?.[0],
            hasHtml: !!message.html,
            hasText: !!message.text,
          })
        )
    ),

    sendBatch: Effect.fn("resend.sendBatch")(
      function* (messages, options) {
        if (messages.some((message) => message.attachments?.length)) {
          return yield* new EmailServiceError(
            "Resend batch emails cannot carry attachments",
            undefined,
            "resend"
          );
        }
        yield* Effect.logInfo("Sending email batch via Resend", {
          category: messages[0]?.tags?.[0],
          size: messages.length,
        });

        const data = yield* requestResend(
          () =>
            resend.batch.send(messages.map(toResendEmail), {
              idempotencyKey: getResendIdempotencyKey(options.idempotencyKey),
            }),
          resendBatchSendTimeout
        );

        const ids = data?.data ?? [];
        if (ids.length !== messages.length) {
          return yield* new EmailServiceError(
            "Resend batch response did not match the batch size",
            undefined,
            "resend"
          );
        }

        const timestamp = new Date();
        return yield* Effect.forEach(ids, ({ id }) =>
          decodeDeliveryId(id).pipe(
            Effect.map(
              (deliveryId): EmailSendResult => ({
                id: deliveryId,
                status: "sent",
                provider: "resend",
                timestamp,
              })
            )
          )
        );
      },
      (effect, messages) =>
        effect.pipe(
          Effect.scoped,
          Effect.annotateLogs({
            provider: "resend",
            category: messages[0]?.tags?.[0],
            size: messages.length,
          })
        )
    ),

    verify: Effect.gen(function* () {
      yield* Effect.logInfo("Resend API key verification started");

      return yield* Effect.tryPromise({
        try: async () => {
          return await resend.domains.list();
        },
        catch: () =>
          // Discard the exception so failed spans cannot expose provider data.
          new EmailServiceError("Failed to verify Resend API key"),
      }).pipe(
        Effect.flatMap((response) => {
          const resendError = response.error;
          if (!resendError) return Effect.succeed(true);

          return Effect.fail(
            new EmailServiceError(
              "Failed to verify Resend API key",
              undefined,
              "resend"
            )
          );
        }),
        Effect.tap((_success) =>
          Effect.logInfo("Resend API key verified successfully")
        ),
        Effect.tapError((error) =>
          Effect.logError("Resend API key verification failed", {
            errorType: error._tag,
          })
        )
      );
    }).pipe(
      Effect.scoped,
      Effect.annotateLogs({ provider: "resend" }),
      Effect.withSpan("resend.verify")
    ),
  };
};

const resendIdempotencyKeyMaxLength = 256;

const getResendIdempotencyKey = (idempotencyKey: string | undefined) =>
  idempotencyKey?.slice(0, resendIdempotencyKeyMaxLength);

export const ResendEmailProviderLive = Layer.effect(
  EmailProviderTag,
  Effect.gen(function* () {
    const config = yield* EmailConfigTag;
    const apiKey = config.apiKey?.trim() ?? "";

    if (!apiKey) {
      return yield* new EmailServiceError(
        "EMAIL_API_KEY is required for Resend email provider",
        undefined,
        "resend"
      );
    }

    return createResendProvider(apiKey);
  })
);
