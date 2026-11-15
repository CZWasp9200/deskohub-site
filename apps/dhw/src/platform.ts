import { BunCrypto, BunServices } from "@effect/platform-bun";
import { Layer } from "effect";

/** The Bun platform services `dhw` runs on: process, file system, terminal, and crypto. */
export const PlatformLive = Layer.mergeAll(
  BunServices.layer,
  BunCrypto.layerSecureRandom,
  BunCrypto.layerDigest
);
