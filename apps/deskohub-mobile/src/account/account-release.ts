import { useFeatureFlagEnabled } from "../analytics/feature-flags";
import type { AccountRelease } from "./account-gating";
import { paymentMethodsFeatureFlag } from "./account-root-model";

/**
 * The releases the Account tab's sections wait for, read from their feature
 * flags. A flag that is unknown, not loaded yet or without consent is off.
 */
export const useAccountRelease = (): AccountRelease => ({
  paymentMethods: useFeatureFlagEnabled(paymentMethodsFeatureFlag, false),
});
