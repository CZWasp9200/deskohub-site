import Check from "lucide-react-native/icons/check";
import Globe from "lucide-react-native/icons/globe";
import { StyleSheet, View } from "react-native";
import { Badge } from "../badge";
import { Notice } from "../notice";
import { space } from "../tokens";
import { GalleryCase, GallerySection, useSample } from "./gallery-kit";

const ignore = () => undefined;

/** Board 00d part 8: notices in every tone and badges in every tone. */
export function StatusSection() {
  const sample = useSample();
  return (
    <GallerySection title="Notices and badges">
      <GalleryCase label="Info">
        <Notice
          tone="info"
          message={sample("Documents open on the Deskohub Workspace website.")}
        />
      </GalleryCase>
      <GalleryCase label="Positive">
        <Notice tone="positive" message={sample("Your profile is ready.")} />
      </GalleryCase>
      <GalleryCase label="Warning">
        <Notice
          tone="warning"
          message={sample("Saving removes your saved billing address.")}
        />
      </GalleryCase>
      <GalleryCase label="Error with a title and an action">
        <Notice
          tone="error"
          title={sample("Couldn’t create profile")}
          message={sample("Check your connection and try again.")}
          action={{ label: sample("Try again"), onPress: ignore }}
        />
      </GalleryCase>
      <GalleryCase label="Info with its own icon">
        <Notice
          tone="info"
          icon={Globe}
          message={sample("Documents open on the Deskohub Workspace website.")}
        />
      </GalleryCase>
      <GalleryCase label="Badges: every tone, with and without an icon">
        <View style={styles.badges}>
          <Badge label={sample("Verified")} tone="positive" icon={Check} />
          <Badge label={sample("Always on")} tone="positive" />
          <Badge label={sample("Pending")} tone="warning" />
          <Badge label={sample("Cancelled")} tone="danger" />
          <Badge label={sample("Upcoming")} tone="info" />
          <Badge label={sample("Past")} tone="neutral" />
        </View>
      </GalleryCase>
    </GallerySection>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
