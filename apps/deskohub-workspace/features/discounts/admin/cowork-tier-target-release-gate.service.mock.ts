import { Layer } from "effect";
import { CoworkTierTargetReleaseGate } from "./cowork-tier-target-release-gate.service";

export const CoworkTierTargetReleaseGateMock = Layer.mock(
  CoworkTierTargetReleaseGate
);
