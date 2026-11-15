import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppBar } from "../../src/ui/app-bar";
import { Button } from "../../src/ui/controls";
import { FocusedStatusBar } from "../../src/ui/focused-status-bar";
import { LongTextProvider } from "../../src/ui/gallery/gallery-kit";
import { gallerySections } from "../../src/ui/gallery/sections";
import { ListGroup, ListRow } from "../../src/ui/list";
import { ScrollScreen } from "../../src/ui/scroll-screen";
import { Text } from "../../src/ui/text";
import { color } from "../../src/ui/tokens";

/**
 * Development-only gallery of the design system: every component in every
 * state on the foundation boards (00–00e). `?section=<key>` opens a section
 * and `?long=1` stretches every sample 30%, so a capture can deep-link
 * straight to a state (`deskohub://dev/design-system?section=buttons&long=1`).
 */
export default function DesignSystemRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <DesignSystemGallery />;
}

function DesignSystemGallery() {
  const { section, long } = useLocalSearchParams<{
    section?: string;
    long?: string;
  }>();
  const { width, fontScale } = useWindowDimensions();
  const open = gallerySections.find((entry) => entry.key === section);
  const longText = long === "1";
  return (
    <SafeAreaView
      edges={["top"]}
      style={{ flex: 1, backgroundColor: color.paper }}
    >
      <FocusedStatusBar style="dark" />
      <AppBar
        title={open ? open.title : "Design system"}
        onBack={galleryBack(open !== undefined)}
      />
      <LongTextProvider value={longText}>
        <ScrollScreen>
          <Text variant="hint">
            {`${Math.round(width)} dp wide, font ${Math.round(fontScale * 100)}%, ${longText ? "text +30%" : "text as written"}`}
          </Text>
          {open ? (
            <open.Section />
          ) : (
            <>
              <Button
                label={
                  longText ? "Show text as written" : "Show text 30% longer"
                }
                variant="secondary"
                onPress={() =>
                  router.setParams({ long: longText ? undefined : "1" })
                }
              />
              <ListGroup>
                {gallerySections.map((entry) => (
                  <ListRow
                    key={entry.key}
                    label={entry.title}
                    onPress={() => router.setParams({ section: entry.key })}
                  />
                ))}
              </ListGroup>
            </>
          )}
        </ScrollScreen>
      </LongTextProvider>
    </SafeAreaView>
  );
}

/** Back from a section goes to the gallery's index; from the index, to where the gallery was opened from. */
const galleryBack = (sectionOpen: boolean) => {
  if (sectionOpen) return () => router.setParams({ section: undefined });
  return router.canGoBack() ? () => router.back() : undefined;
};
