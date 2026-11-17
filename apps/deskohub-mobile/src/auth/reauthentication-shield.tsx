import { brandLogoMark } from "@deskohub/brand-tokens";
import { Platform, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { iconHiddenProps } from "../ui/icon";
import { color } from "../ui/tokens";

/** The shield's outline, on a 24-unit square. */
const shieldPath =
  "M4 5C6 5 9.5 3.9 12 2C14.5 3.9 18 5 20 5V13C20 18 16.5 20.5 12 22C7.5 20.5 4 18 4 13Z";

/** The shield's side, and the mark's width as a share of it. */
const shieldSize = 208;
const markWidth = Math.round(shieldSize * 0.62);
const markHeight = Math.round(
  (markWidth * brandLogoMark.viewBox.height) / brandLogoMark.viewBox.width
);

/**
 * The large grey shield with the Deskohub mark inside, above the locked
 * email when the app asks the customer to confirm it's them. Decorative: the
 * title says what the page is for.
 */
export function ReauthenticationShield() {
  const hidden = iconHiddenProps(Platform.OS);
  return (
    <View style={styles.frame} {...hidden}>
      <Svg width={shieldSize} height={shieldSize} viewBox="0 0 24 24">
        <Path
          d={shieldPath}
          fill="none"
          stroke={color.illustration}
          strokeWidth={0.7}
          strokeLinejoin="miter"
          strokeMiterlimit={10}
        />
      </Svg>
      <View style={styles.mark}>
        <Svg
          width={markWidth}
          height={markHeight}
          viewBox={`0 0 ${brandLogoMark.viewBox.width} ${brandLogoMark.viewBox.height}`}
        >
          <Path d={brandLogoMark.path} fill={color.illustration} />
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: shieldSize,
    height: shieldSize,
    alignSelf: "center",
  },
  // Centred a little above the middle, where the shield is widest.
  mark: {
    position: "absolute",
    left: (shieldSize - markWidth) / 2,
    top: shieldSize * 0.48 - markHeight / 2,
  },
});
