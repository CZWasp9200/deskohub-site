import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { color } from "./tokens";
import { AvailableWidthContext, useViewport } from "./viewport";

const listWidth = 400;

/** Keep the detail navigator in the same position during window resizing. */
export function SplitPane({
  list,
  children,
  enabled = true,
}: {
  readonly list: ReactNode;
  readonly children: ReactNode;
  readonly enabled?: boolean;
}) {
  const { availableWidth, isExpanded } = useViewport();
  const showList = isExpanded && enabled;
  return (
    <View style={styles.frame}>
      <View style={[styles.list, !showList && styles.hidden]}>
        <AvailableWidthContext value={listWidth}>{list}</AvailableWidthContext>
      </View>
      <View style={styles.detail}>
        <AvailableWidthContext
          value={showList ? availableWidth - listWidth : availableWidth}
        >
          {children}
        </AvailableWidthContext>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, flexDirection: "row" },
  list: {
    borderRightColor: color.line,
    borderRightWidth: StyleSheet.hairlineWidth,
    width: listWidth,
  },
  hidden: { display: "none" },
  detail: { flex: 1, minWidth: 0 },
});
