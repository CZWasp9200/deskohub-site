import {
  AdministrationCampaignAudience,
  AdministrationCampaignDetail,
  AdministrationDiscountMutationResult,
  AdministrationReservationAccessGrant,
  AdministrationStandaloneAccessCodeResult,
  CliMutationInProgress,
  CliMutationRejected,
  type CliMutationRequestIdType,
  type CliSessionIdType,
} from "@deskohub/workspace-admin-api";
import { and, eq, isNull, lte } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer, Match, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type CliStoredMutation,
  type CliStoredMutationResult,
  cliMutationRequests,
} from "@/db/schema";

type CliMutationClaim =
  | { readonly kind: "claimed" }
  | {
      readonly kind: "completed";
      readonly result: CliStoredMutationResult;
    }
  | { readonly kind: "in-progress" }
  | { readonly kind: "mismatch" };

export type CliMutationRequest = {
  readonly sessionId: CliSessionIdType;
  readonly requestId: CliMutationRequestIdType;
  readonly mutation: CliStoredMutation;
};

interface ICliMutationIdempotency {
  readonly claim: (
    request: CliMutationRequest
  ) => Effect.Effect<
    CliMutationClaim,
    EffectDrizzleQueryError | Schema.SchemaError
  >;
  readonly complete: (
    request: CliMutationRequest & {
      readonly result: CliStoredMutationResult;
    }
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
  readonly release: (
    request: CliMutationRequest
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
  readonly reclaimStale: (
    request: CliMutationRequest & {
      readonly reclaimedAt: Temporal.Instant;
      readonly staleBefore: Temporal.Instant;
    }
  ) => Effect.Effect<boolean, EffectDrizzleQueryError>;
}

export class CliMutationIdempotency extends Context.Service<
  CliMutationIdempotency,
  ICliMutationIdempotency
>()("@deskohub-workspace/admin-cli/CliMutationIdempotency") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const claim = Effect.fn("CliMutationIdempotency.claim")(function* (
        request: CliMutationRequest
      ) {
        const inserted = yield* db
          .insert(cliMutationRequests)
          .values(request)
          .onConflictDoNothing()
          .returning({ requestId: cliMutationRequests.requestId });
        if (inserted.length > 0) {
          return { kind: "claimed" } as const;
        }

        const rows = yield* db
          .select({ result: cliMutationRequests.result })
          .from(cliMutationRequests)
          .where(
            and(
              eq(cliMutationRequests.sessionId, request.sessionId),
              eq(cliMutationRequests.requestId, request.requestId),
              eq(cliMutationRequests.mutation, request.mutation)
            )
          )
          .limit(1);
        const row = rows[0];
        if (!row) return { kind: "mismatch" } as const;
        if (row.result === null) return { kind: "in-progress" } as const;

        const result = yield* Schema.decodeUnknownEffect(
          Schema.Union([
            AdministrationDiscountMutationResult,
            AdministrationReservationAccessGrant,
            AdministrationStandaloneAccessCodeResult,
            AdministrationCampaignAudience,
            AdministrationCampaignDetail,
          ])
        )(row.result);
        return { kind: "completed", result } as const;
      });

      const complete = Effect.fn("CliMutationIdempotency.complete")(
        (
          request: CliMutationRequest & {
            readonly result: CliStoredMutationResult;
          }
        ) =>
          db
            .update(cliMutationRequests)
            .set({
              result: request.result,
              completedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                eq(cliMutationRequests.sessionId, request.sessionId),
                eq(cliMutationRequests.requestId, request.requestId),
                eq(cliMutationRequests.mutation, request.mutation),
                isNull(cliMutationRequests.result)
              )
            )
            .returning({ requestId: cliMutationRequests.requestId })
            .pipe(
              Effect.flatMap((rows) =>
                rows.length > 0
                  ? Effect.void
                  : Effect.die(
                      new Error(
                        "Claimed CLI mutation could not be completed idempotently."
                      )
                    )
              )
            )
      );

      const release = Effect.fn("CliMutationIdempotency.release")(
        (request: CliMutationRequest) =>
          db
            .delete(cliMutationRequests)
            .where(
              and(
                eq(cliMutationRequests.sessionId, request.sessionId),
                eq(cliMutationRequests.requestId, request.requestId),
                eq(cliMutationRequests.mutation, request.mutation),
                isNull(cliMutationRequests.result)
              )
            )
            .pipe(Effect.asVoid)
      );

      const reclaimStale = Effect.fn("CliMutationIdempotency.reclaimStale")(
        (
          request: CliMutationRequest & {
            readonly reclaimedAt: Temporal.Instant;
            readonly staleBefore: Temporal.Instant;
          }
        ) =>
          db
            .update(cliMutationRequests)
            .set({ createdAt: request.reclaimedAt })
            .where(
              and(
                eq(cliMutationRequests.sessionId, request.sessionId),
                eq(cliMutationRequests.requestId, request.requestId),
                eq(cliMutationRequests.mutation, request.mutation),
                isNull(cliMutationRequests.result),
                lte(cliMutationRequests.createdAt, request.staleBefore)
              )
            )
            .returning({ requestId: cliMutationRequests.requestId })
            .pipe(Effect.map((rows) => rows.length > 0))
      );

      return {
        claim,
        complete,
        reclaimStale,
        release,
      } satisfies ICliMutationIdempotency;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}

/**
 * Applies a CLI mutation at most once per session and request ID. A retry
 * replays the stored result. A failure that `releaseOn` accepts proves
 * nothing was applied, so it frees the request ID for a corrected retry;
 * any other failure keeps the claim, and retries report it in progress.
 */
export const applyCliMutationOnce = <A extends CliStoredMutationResult, E, R>(
  ledger: CliMutationIdempotency["Service"],
  input: {
    readonly request: CliMutationRequest;
    readonly result: Schema.Decoder<A>;
    readonly apply: Effect.Effect<A, E, R>;
    readonly releaseOn: (cause: E) => boolean;
  }
) =>
  Effect.gen(function* () {
    const claim = yield* ledger.claim(input.request);
    return yield* Match.value(claim).pipe(
      Match.discriminatorsExhaustive("kind")({
        claimed: () =>
          input.apply.pipe(
            Effect.tapError((cause) =>
              input.releaseOn(cause)
                ? ledger.release(input.request).pipe(Effect.ignore)
                : Effect.void
            ),
            Effect.tap((result) =>
              ledger.complete({ ...input.request, result })
            )
          ),
        completed: ({ result }) =>
          Schema.decodeUnknownEffect(input.result)(result),
        "in-progress": () =>
          new CliMutationInProgress({
            requestId: input.request.requestId,
            message:
              "This mutation is still being applied. Retrying with the same request identifier is safe.",
          }),
        mismatch: () =>
          new CliMutationRejected({
            message:
              "This mutation request identifier was already used for different input.",
          }),
      })
    );
  });
