import { StyleSheet } from "react-native";
import { color, radius, space } from "./tokens";

const iconTileSize = 40;
const rowGap = 14;

/**
 * The layout every row inside a `ListGroup` shares, so a list, switch or
 * checkbox row lines up with its neighbours and the group's dividers start
 * under the text: 56 tall (72 with a description), the 40 icon tile, 14
 * between the parts and the 16 gutter.
 */
export const listRowLayout = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: rowGap,
    minHeight: 56,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  withDescription: { minHeight: 72 },
  iconTile: {
    alignItems: "center",
    backgroundColor: color.sunken,
    borderRadius: radius.tile,
    height: iconTileSize,
    justifyContent: "center",
    width: iconTileSize,
  },
  /** The label and description column; it takes the room the row leaves. */
  text: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
});

/**
 * Where a divider between two rows starts: under the text, past the icon
 * tile, unless neither row has an icon.
 */
export const listDividerInset = (icons: {
  readonly above: boolean;
  readonly below: boolean;
}) =>
  icons.above || icons.below ? space.lg + iconTileSize + rowGap : space.lg;
