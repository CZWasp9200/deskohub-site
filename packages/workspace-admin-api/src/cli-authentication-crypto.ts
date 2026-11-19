import { Effect } from "effect";
import { Digest, SecureRandom } from "effect/crypto";
import { Base64Url } from "effect/encoding";
import {
  CliAuthenticationChallenge,
  CliAuthenticationVerifier,
} from "./workspace-admin-api";

const encoder = new TextEncoder();

export const makeCliAuthenticationSecret = Effect.fn(
  "CliAuthenticationCrypto.makeSecret"
)(function* () {
  const random = yield* SecureRandom.SecureRandom;
  return Base64Url.encode(yield* random.randomBytes(32));
});

export const digestCliAuthenticationSecret = Effect.fn(
  "CliAuthenticationCrypto.digestSecret"
)(function* (secret: string) {
  const digest = yield* Digest.Digest;
  return Base64Url.encode(
    yield* digest.digest(Digest.sha256, encoder.encode(secret))
  );
});

export const makeCliAuthenticationVerifier = makeCliAuthenticationSecret().pipe(
  Effect.map(CliAuthenticationVerifier.make)
);

export const makeCliAuthenticationChallenge = Effect.fn(
  "CliAuthenticationCrypto.makeChallenge"
)((verifier: CliAuthenticationVerifier) =>
  digestCliAuthenticationSecret(verifier).pipe(
    Effect.map(CliAuthenticationChallenge.make)
  )
);
