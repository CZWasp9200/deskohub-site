import {
  type AdministrationChannel,
  CurrentAdministrationCaller,
} from "@deskohub/workspace-admin-api";
import { Effect, Match } from "effect";

/**
 * The provenance source invoices and access-code events record for an
 * administration channel.
 */
const provenanceSourceOf = (channel: AdministrationChannel) =>
  Match.value(channel).pipe(
    Match.tagsExhaustive({
      AdminUi: () => "admin-ui" as const,
      CliSession: () => "dhw-cli" as const,
      AssistantConnection: () => "assistant" as const,
    })
  );

/**
 * The provenance an administration operation records: the calling
 * administrator as its actor and the caller's channel as its source. The
 * Admin UI and the administration API both take it from the caller, never
 * from request input.
 */
export const currentAdministrationProvenance = Effect.gen(function* () {
  const { actor, channel } = yield* CurrentAdministrationCaller;
  return { actor, source: provenanceSourceOf(channel) };
});
