import { Redirect, router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { boardFrames } from "../../src/booking/ui/gallery/board-frames";
import { bookingGallerySections } from "../../src/booking/ui/gallery/sections";
import { AppBar } from "../../src/ui/app-bar";
import { Button } from "../../src/ui/controls";
import { FocusedStatusBar } from "../../src/ui/focused-status-bar";
import { LongTextProvider } from "../../src/ui/gallery/gallery-kit";
import { ListGroup, ListRow } from "../../src/ui/list";
import { ScrollScreen } from "../../src/ui/scroll-screen";
import { Text } from "../../src/ui/text";
import { color } from "../../src/ui/tokens";

/**
 * Development-only gallery of the shared booking pieces (boards 26–36):
 * step progress, calendar, booking bar with its price breakdown, price
 * card, hold chip and the end-of-hold dialog, in every state.
 * `?section=<key>` opens a section, `?frame=<key>` shows one board frame
 * full screen, edge to edge, and `?long=1` stretches sample text 30%, so a
 * capture can deep-link to a state
 * (`deskohub://dev/booking-components?frame=cowork-chosen&long=1`).
 */
export default function BookingComponentsRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <BookingComponentsGallery />;
}

function BookingComponentsGallery() {
  const { section, frame, long } = useLocalSearchParams<{
    section?: string;
    frame?: string;
    long?: string;
  }>();
  const open = bookingGallerySections.find((entry) => entry.key === section);
  const shown = boardFrames.find((entry) => entry.key === frame);
  const longText = long === "1";
  if (shown) {
    return (
      <LongTextProvider value={longText}>
        <shown.Screen onBack={() => router.setParams({ frame: undefined })} />
      </LongTextProvider>
    );
  }
  return (
    <SafeAreaView
      edges={["top"]}
      style={{ flex: 1, backgroundColor: color.paper }}
    >
      <FocusedStatusBar style="dark" />
      <AppBar
        title={open ? open.title : "Booking components"}
        onBack={galleryBack(open !== undefined)}
      />
      <LongTextProvider value={longText}>
        {open ? (
          <open.Section />
        ) : (
          <ScrollScreen>
            <Button
              label={longText ? "Show text as written" : "Show text 30% longer"}
              variant="secondary"
              onPress={() =>
                router.setParams({ long: longText ? undefined : "1" })
              }
            />
            <ListGroup>
              {bookingGallerySections.map((entry) => (
                <ListRow
                  key={entry.key}
                  label={entry.title}
                  onPress={() => router.setParams({ section: entry.key })}
                />
              ))}
            </ListGroup>
            <Text variant="headline" role="heading">
              Board frames
            </Text>
            <ListGroup>
              {boardFrames.map((entry) => (
                <ListRow
                  key={entry.key}
                  label={`${entry.board} · ${entry.state}`}
                  onPress={() => router.setParams({ frame: entry.key })}
                />
              ))}
            </ListGroup>
          </ScrollScreen>
        )}
      </LongTextProvider>
    </SafeAreaView>
  );
}

/** Back from a section goes to the gallery's index; from the index, to where the gallery was opened from. */
const galleryBack = (sectionOpen: boolean) => {
  if (sectionOpen) return () => router.setParams({ section: undefined });
  return router.canGoBack() ? () => router.back() : undefined;
};
