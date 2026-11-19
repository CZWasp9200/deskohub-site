import type { CustomerReservationFamily } from "@deskohub/workspace-customer-api";
import {
  Image,
  type ImageSourcePropType,
  StyleSheet,
  View,
} from "react-native";
import { color } from "../../ui/tokens";

/** How a drawing fills a box as wide as the screen. */
type FullWidthPlacement =
  /** The whole drawing, as on a half-width card. */
  | { readonly kind: "whole" }
  /**
   * Drawn at 140% of the box height, centred across; `bottomCrop` of the
   * box height comes off the drawing's bottom and the rest off its top.
   */
  | { readonly kind: "enlarged"; readonly bottomCrop: number };

interface SpaceDrawing {
  readonly source: ImageSourcePropType;
  /** Width over height. */
  readonly aspectRatio: number;
  readonly fullWidth: FullWidthPlacement;
}

/** An enlarged drawing's height, relative to its box (owner, 2026-11-15). */
const enlargement = 1.4;

/**
 * The owner's drawing of each space: the cowork desk the website shows, and
 * the meeting room and the office drawn in its style.
 */
const spaceDrawings: Record<CustomerReservationFamily, SpaceDrawing> = {
  cowork: {
    source: require("../../../assets/images/booking/reserved-desk.webp"),
    aspectRatio: 630 / 477,
    fullWidth: { kind: "whole" },
  },
  "meeting-room": {
    source: require("../../../assets/images/booking/meeting-room-illustration.webp"),
    aspectRatio: 900 / 759,
    fullWidth: { kind: "enlarged", bottomCrop: 0.08 },
  },
  office: {
    // The chairs stand on the bottom edge: only the top is cropped.
    source: require("../../../assets/images/booking/office-illustration.webp"),
    aspectRatio: 900 / 701,
    fullWidth: { kind: "enlarged", bottomCrop: 0 },
  },
};

/** Where an enlarged drawing sits in a box of `height`. */
const enlargedDrawingFrame = (height: number, bottomCrop: number) => {
  const drawingHeight = height * enlargement;
  return {
    height: drawingHeight,
    top: height * (1 + bottomCrop) - drawingHeight,
  };
};

/**
 * A space's drawing on its tint, in a box of `height` as wide as its parent.
 * A half-width box shows the whole drawing; a full-width one places it as
 * the owner set for that space. It is decorative.
 */
export function SpaceIllustration({
  family,
  height,
  span,
}: {
  readonly family: CustomerReservationFamily;
  readonly height: number;
  readonly span: "half" | "full";
}) {
  const drawing = spaceDrawings[family];
  const placement: FullWidthPlacement =
    span === "full" ? drawing.fullWidth : { kind: "whole" };
  return (
    <View
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.box, { height }]}
    >
      <Image
        source={drawing.source}
        resizeMode="contain"
        style={
          placement.kind === "whole"
            ? styles.whole
            : {
                aspectRatio: drawing.aspectRatio,
                position: "absolute",
                ...enlargedDrawingFrame(height, placement.bottomCrop),
              }
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: "center",
    backgroundColor: color.illustrationTint,
    overflow: "hidden",
  },
  whole: { height: "100%", width: "100%" },
});
