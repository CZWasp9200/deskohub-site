import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import { Data, Effect } from "effect";
import { workspaceServiceResourceAttributes } from "../observability/workspace-service";

const POSTHOG_LOGS_PATH = "/i/v1/logs";

type PostHogLoggerProviderOptions = {
  readonly posthogHost?: string;
  readonly posthogProjectToken?: string;
  readonly vercelEnv?: string;
  readonly vercelGitCommitSha?: string;
};

type PostHogLogsFlushProvider = Pick<LoggerProvider, "forceFlush">;

type PostHogLogsFlushOptions = {
  readonly provider: PostHogLogsFlushProvider | undefined;
  readonly timeoutMs?: number;
};

const postHogLogsFlushTimeoutMs = 2_000;

function getPostHogLogsEndpoint(posthogHost: string) {
  return new URL(POSTHOG_LOGS_PATH, posthogHost).toString();
}

export function createPostHogLoggerProvider({
  posthogHost,
  posthogProjectToken,
  vercelEnv,
  vercelGitCommitSha,
}: PostHogLoggerProviderOptions) {
  if (!posthogProjectToken) return undefined;
  if (!posthogHost) {
    throw new Error(
      "POSTHOG_INGEST_HOST is required when PostHog logging is enabled"
    );
  }
  if (!vercelEnv) {
    throw new Error("VERCEL_ENV is required when PostHog logging is enabled");
  }

  return new LoggerProvider({
    resource: resourceFromAttributes({
      "deployment.environment.name": vercelEnv,
      ...workspaceServiceResourceAttributes,
      "service.version": vercelGitCommitSha,
    }),
    processors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({
          headers: {
            Authorization: `Bearer ${posthogProjectToken}`,
            "Content-Type": "application/json",
          },
          timeoutMillis: postHogLogsFlushTimeoutMs,
          url: getPostHogLogsEndpoint(posthogHost),
        }),
        exportTimeoutMillis: postHogLogsFlushTimeoutMs,
      }),
    ],
  });
}

class PostHogLogsFlushError extends Data.TaggedError("PostHogLogsFlushError")<{
  readonly cause: unknown;
}> {}

/**
 * Flushes buffered PostHog log records within the post-response deadline.
 * Never fails: a rejected or overdue flush is logged as a warning.
 */
export const flushPostHogLogs = ({
  provider,
  timeoutMs = postHogLogsFlushTimeoutMs,
}: PostHogLogsFlushOptions): Effect.Effect<void> =>
  provider
    ? Effect.tryPromise({
        try: () => provider.forceFlush({ timeoutMillis: timeoutMs }),
        catch: (cause) => new PostHogLogsFlushError({ cause }),
      }).pipe(
        Effect.timeout(timeoutMs),
        Effect.catchTags({
          PostHogLogsFlushError: ({ cause }) =>
            Effect.logWarning("PostHog log flush failed.", { cause }),
          TimeoutError: () =>
            Effect.logWarning(
              "PostHog log flush exceeded its post-response deadline."
            ),
        })
      )
    : Effect.void;
