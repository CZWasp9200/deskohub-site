import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import WifiOff from "lucide-react-native/icons/wifi-off";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Card } from "./card";
import { Button } from "./controls";
import { EmptyState } from "./empty-state";
import { useLiveRegionAnnouncement } from "./live-announcement";
import { LoadingIndicator } from "./loading-indicator";
import { idleLiveRegionLayout } from "./notice-presentation";
import { Text } from "./text";
import { space } from "./tokens";

/**
 * Fills the screen while its content first loads. The indicator carries
 * `label` for assistive tech; there is no visible loading copy.
 */
export function LoadingState({ label }: { readonly label: string }) {
  return (
    <View style={[styles.centered, styles.centeredAcross]}>
      <LoadingIndicator size="section" tone="brand" label={label} />
    </View>
  );
}

/**
 * Replaces the screen's content when it couldn't load: a card in the
 * content's place (over a tab root's masthead, like the content) with an
 * empty state that says so, and a retry button that shows progress while the retry runs. Its
 * alert region mounts empty and takes the message right after, since screen
 * readers often skip a region inserted together with its text. With a
 * `title` naming what didn't load, `message` is the line under it.
 */
export function ErrorState({
  title,
  message,
  retryLabel,
  onRetry,
  retrying = false,
}: {
  readonly title?: string;
  readonly message: string;
  readonly retryLabel: string;
  readonly onRetry: () => void;
  readonly retrying?: boolean;
}) {
  const [alert, setAlert] = useState<string>();
  const headline = title ?? message;
  useEffect(() => setAlert(headline), [headline]);
  return (
    <Card padding="none">
      <View style={styles.errorCard}>
        <EmptyState
          icon={WifiOff}
          title={alert ?? ""}
          body={title === undefined ? undefined : message}
          live="assertive"
        >
          <Button
            variant="secondary"
            icon={RotateCcw}
            label={retryLabel}
            onPress={onRetry}
            busy={retrying}
          />
        </EmptyState>
      </View>
    </Card>
  );
}

/**
 * A quiet status line that says content already on screen is being
 * refreshed. It stays mounted as a status region and shows `label` only
 * while `refreshing`, and takes no room while idle. It draws no indicator of its own: the screen's
 * `ScrollScreen` shows the one loading indicator at the top.
 */
export function RefreshingIndicator({
  refreshing,
  label,
}: {
  readonly refreshing: boolean;
  readonly label: string;
}) {
  const message = refreshing ? label : undefined;
  useLiveRegionAnnouncement(message, "polite");
  return (
    <Text
      role="status"
      aria-live="polite"
      // Text doesn't map `aria-live` to Android's live region; View does.
      accessibilityLiveRegion="polite"
      variant="caption"
      tone="muted"
      // Idle, it takes no room, so the first content still overlaps a tab
      // root's masthead.
      style={refreshing ? styles.refreshing : idleLiveRegionLayout}
    >
      {message ?? ""}
    </Text>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: "center",
    minHeight: 200,
    padding: space.lg,
  },
  centeredAcross: { alignItems: "center" },
  errorCard: {
    paddingBottom: space.xxl,
    paddingHorizontal: space.xs,
    paddingTop: space.sm,
  },
  refreshing: { textAlign: "center" },
});
