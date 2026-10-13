import { getWorkspaceProductByTier } from "@/features/checkout/product-catalog";
import {
  getWorkspaceProductTargetKey,
  type WorkspaceProductTarget,
  type WorkspaceProductTargetKey,
  workspaceCoworkTierProductTargets,
  workspaceProductTargets,
} from "@/features/discounts/product-target";

const getDiscountProductTargetLabel = (
  target: WorkspaceProductTarget
): string => {
  if (target.kind === "cowork") {
    return target.tier === undefined
      ? "All cowork tiers"
      : `${getWorkspaceProductByTier(target.tier).label} only`;
  }
  return { "meeting-room": "Meeting room", office: "Private office" }[
    target.kind
  ];
};

/** Every target an operator can choose, with each cowork tier after cowork. */
export const discountProductTargetOptions = workspaceProductTargets
  .flatMap((target): readonly WorkspaceProductTarget[] =>
    target.kind === "cowork"
      ? [target, ...workspaceCoworkTierProductTargets]
      : [target]
  )
  .map((target) => ({
    key: getWorkspaceProductTargetKey(target),
    label: getDiscountProductTargetLabel(target),
    target,
  }));

export const discountProductTargetKeys = discountProductTargetOptions.map(
  ({ key }) => key
) as [WorkspaceProductTargetKey, ...WorkspaceProductTargetKey[]];

/** Maps chosen option keys to targets in option order. */
export const toDiscountProductTargets = (
  keys: readonly WorkspaceProductTargetKey[]
): WorkspaceProductTarget[] =>
  discountProductTargetOptions
    .filter(({ key }) => keys.includes(key))
    .map(({ target }) => target);

export const formatDiscountProductTargets = (
  targets: readonly WorkspaceProductTarget[]
) => targets.map(getDiscountProductTargetLabel).join(", ");

/** Why a single-tier cowork target cannot be added before its release. */
export const unreleasedCoworkTierTargetMessage =
  "Adding single cowork tier targets is not enabled yet. Choose All cowork tiers instead.";
