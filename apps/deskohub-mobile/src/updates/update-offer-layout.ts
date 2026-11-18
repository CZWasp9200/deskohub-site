import { space, touchTarget } from "../ui/tokens";

/** The quiet update card's fixed measures, shared by its styles and its layout rule. */
export const updateOfferMetrics = {
  /** The card's left padding; the dismiss button's target reaches its right edge. */
  paddingStart: space.lg,
  iconSize: 20,
  dismissSize: touchTarget,
  /** The gap between the icon, the message, the action and the dismiss button. */
  gap: space.md,
  /**
   * The action's label is drawn alone, this much further from the message
   * than the gap; its target reaches this far to each side.
   */
  actionInset: space.sm,
  /** The narrowest message column, at font scale 1, the action may sit beside. */
  inlineMessageMinWidth: 160,
} as const;

export type UpdateOfferActionPlacement = "inline" | "stacked";

/**
 * Where the quiet update card's action goes: on the message's row, to its
 * right, when the message column left beside it stays at least
 * `inlineMessageMinWidth` (about two lines) at the current font scale;
 * otherwise under the message, so the message is never squeezed. The same
 * rule decides at every width and font size.
 */
export const updateOfferActionPlacement = ({
  cardWidth,
  actionLabelWidth,
  fontScale,
}: {
  readonly cardWidth: number;
  readonly actionLabelWidth: number;
  readonly fontScale: number;
}): UpdateOfferActionPlacement => {
  const {
    paddingStart,
    iconSize,
    dismissSize,
    gap,
    actionInset,
    inlineMessageMinWidth,
  } = updateOfferMetrics;
  const messageWidth =
    cardWidth -
    paddingStart -
    iconSize -
    dismissSize -
    (actionInset + actionLabelWidth) -
    3 * gap;
  return messageWidth >= inlineMessageMinWidth * fontScale
    ? "inline"
    : "stacked";
};
