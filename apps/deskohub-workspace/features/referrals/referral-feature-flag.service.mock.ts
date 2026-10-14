import { Layer } from "effect";
import { ReferralFeatureFlagService } from "./referral-feature-flag.service";

export const ReferralFeatureFlagServiceMock = Layer.mock(
  ReferralFeatureFlagService
);
