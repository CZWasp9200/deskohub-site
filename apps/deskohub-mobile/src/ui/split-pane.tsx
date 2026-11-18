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
  collapsed = "detail",
}: {
  readonly list: ReactNode;
  readonly children: ReactNode;
  readonly enabled?: boolean;
  readonly collapsed?: "list" | "detail";
}) {
  const { availableWidth, isExpanded } = useViewport();
  const split = isExpanded && enabled;
  const listOnly = !split && collapsed === "list";
  const listStyle = listOnly ? styles.detail : styles.hidden;
  return (
    <View style={styles.frame}>
      <View
        aria-hidden={!split && !listOnly}
        style={split ? styles.list : listStyle}
      >
        <AvailableWidthContext value={split ? listWidth : availableWidth}>
          {list}
        </AvailableWidthContext>
      </View>
      <View
        aria-hidden={listOnly}
        style={listOnly ? styles.hidden : styles.detail}
      >
        <AvailableWidthContext
          value={split ? availableWidth - listWidth : availableWidth}
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
