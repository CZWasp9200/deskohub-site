import { Image, StyleSheet, View } from "react-native";
import { Text } from "../ui/text";
import { color } from "../ui/tokens";

// The landing page's hero photo with the kitchen cropped out, 1080 × 1012.
export const signInHeroPhoto = require("../../assets/images/sign-in-hero.jpg");
const colorLogo = require("../../assets/images/logo-color-on-navy.png");

export function SignInBrand() {
  return (
    <View style={styles.brand}>
      <Image source={colorLogo} style={styles.logo} />
      <View style={styles.brandText}>
        <Text variant="display" tone="inverse" style={styles.wordmark}>
          Deskohub
        </Text>
        <Text variant="hint" style={styles.workspace}>
          WORKSPACE
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: "center", flexDirection: "row", gap: 10 },
  logo: { height: 45, width: 40 },
  brandText: { flexShrink: 1 },
  wordmark: { fontSize: 20, letterSpacing: -0.2, lineHeight: 20 },
  workspace: {
    color: color.onNavyMuted,
    fontSize: 12,
    letterSpacing: 2.4,
    lineHeight: 12,
    marginTop: 4,
  },
});
