import CalendarPlus from "lucide-react-native/icons/calendar-plus";
import { StyleSheet, View } from "react-native";
import { AppBar } from "../app-bar";
import { Button } from "../controls";
import { Masthead } from "../masthead";
import { Text } from "../text";
import { color, radius, space } from "../tokens";
import { GalleryCase, GallerySection, useSample } from "./gallery-kit";

const ignore = () => undefined;

/** Board 00d part 9: the sub-screen app bar and the tab-root masthead. */
export function NavigationSection() {
  const sample = useSample();
  return (
    <>
      <GallerySection title="App bar">
        <GalleryCase label="Sub-screen, with back">
          <AppBar title={sample("Legal and privacy")} onBack={ignore} />
        </GalleryCase>
        <GalleryCase label="With an action">
          <AppBar
            title={sample("Reservations")}
            onBack={ignore}
            actions={
              <Button
                label={sample("Book")}
                icon={CalendarPlus}
                variant="text"
                size="small"
                width="content"
                onPress={ignore}
              />
            }
          />
        </GalleryCase>
        <GalleryCase label="Raised, over scrolled content">
          <AppBar
            title={sample("Sign-in and security")}
            onBack={ignore}
            raised
          />
        </GalleryCase>
        <GalleryCase label="Without back">
          <AppBar title={sample("Design system")} />
        </GalleryCase>
      </GallerySection>
      <GallerySection title="Masthead">
        <GalleryCase label="Tab root">
          <Masthead title={sample("Reservations")} />
        </GalleryCase>
        <GalleryCase label="With a subtitle">
          <Masthead
            title={sample("Book")}
            subtitle={sample("Desks, meeting rooms and private offices")}
          />
        </GalleryCase>
        <GalleryCase label="With the account's identity">
          <Masthead title={sample("Account")}>
            <View style={styles.identity}>
              <View style={styles.avatar}>
                <Text variant="title">JN</Text>
              </View>
              <View style={styles.who}>
                <Text variant="dialogTitle" tone="inverse">
                  {sample("Jana Nováková")}
                </Text>
                <Text variant="bodySmall" style={styles.email}>
                  {sample("jana.novakova@example.com")}
                </Text>
              </View>
            </View>
          </Masthead>
        </GalleryCase>
      </GallerySection>
    </>
  );
}

const styles = StyleSheet.create({
  identity: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
    marginBottom: space.sm,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: color.surface,
    borderRadius: radius.pill,
    height: 56,
    justifyContent: "center",
    width: 56,
  },
  who: { flexShrink: 1, minWidth: 0 },
  email: { color: color.onNavyMuted },
});
