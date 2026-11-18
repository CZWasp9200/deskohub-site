import { describe, expect, test } from "bun:test";
import {
  updateOfferActionPlacement,
  updateOfferMetrics,
} from "./update-offer-layout";

// The card's width less everything on the row but the message and the
// action's label: padding, icon, dismiss target, the action's inset and the
// three gaps.
const fixedWidth =
  updateOfferMetrics.paddingStart +
  updateOfferMetrics.iconSize +
  updateOfferMetrics.dismissSize +
  updateOfferMetrics.actionInset +
  3 * updateOfferMetrics.gap;

describe("updateOfferActionPlacement", () => {
  const actionLabelWidth = 70;

  test("puts the action beside the message while the message keeps its minimum width", () => {
    const cardWidth =
      fixedWidth + actionLabelWidth + updateOfferMetrics.inlineMessageMinWidth;
    expect(
      updateOfferActionPlacement({ cardWidth, actionLabelWidth, fontScale: 1 })
    ).toBe("inline");
    expect(
      updateOfferActionPlacement({
        cardWidth: cardWidth - 1,
        actionLabelWidth,
        fontScale: 1,
      })
    ).toBe("stacked");
  });

  test("a longer label moves the action under the message sooner", () => {
    const cardWidth =
      fixedWidth + actionLabelWidth + updateOfferMetrics.inlineMessageMinWidth;
    expect(
      updateOfferActionPlacement({
        cardWidth,
        actionLabelWidth: actionLabelWidth * 1.3,
        fontScale: 1,
      })
    ).toBe("stacked");
  });

  test("the message's minimum width grows with the font scale", () => {
    const cardWidth =
      fixedWidth +
      2 * actionLabelWidth +
      updateOfferMetrics.inlineMessageMinWidth;
    expect(
      updateOfferActionPlacement({
        cardWidth,
        actionLabelWidth: 2 * actionLabelWidth,
        fontScale: 2,
      })
    ).toBe("stacked");
    expect(
      updateOfferActionPlacement({
        cardWidth: cardWidth + updateOfferMetrics.inlineMessageMinWidth,
        actionLabelWidth: 2 * actionLabelWidth,
        fontScale: 2,
      })
    ).toBe("inline");
  });
});
