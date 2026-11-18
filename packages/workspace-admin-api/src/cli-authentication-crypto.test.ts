import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { Digest, SecureRandom } from "effect/crypto";
import {
  makeCliAuthenticationChallenge,
  makeCliAuthenticationSecret,
} from "./cli-authentication-crypto";
import { CliAuthenticationVerifier } from "./workspace-admin-api";

const crypto = Layer.mergeAll(
  SecureRandom.layerWebCrypto,
  Digest.layerWebCrypto
);

const run = <A, E>(
  effect: Effect.Effect<A, E, SecureRandom.SecureRandom | Digest.Digest>
) => Effect.runPromise(effect.pipe(Effect.provide(crypto)));

describe("CLI authentication crypto", () => {
  test("a secret is 32 random bytes in unpadded base64url", async () => {
    const [first, second] = await run(
      Effect.all([makeCliAuthenticationSecret(), makeCliAuthenticationSecret()])
    );

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });

  test("a challenge is the unpadded base64url SHA-256 of its verifier", async () => {
    // RFC 7636 appendix B.
    const verifier = CliAuthenticationVerifier.make(
      "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    );

    expect(String(await run(makeCliAuthenticationChallenge(verifier)))).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  });
});
