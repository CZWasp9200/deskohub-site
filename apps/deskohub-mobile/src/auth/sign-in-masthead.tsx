import { useState } from "react";
import { Image, type LayoutChangeEvent, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { FocusedStatusBar } from "../ui/focused-status-bar";
import { LogoMark } from "../ui/logo-mark";
import { Text } from "../ui/text";
import { color, space } from "../ui/tokens";
import { QuietUpdateOffer } from "../updates/update-offer-card";

// The landing page's hero photo with its left 40% (the kitchen) cut off,
// 1080 x 1012, about 93 KB.
const heroPhoto = require("../../assets/images/sign-in-hero.jpg");
const heroAspect = 1080 / 1012;
const colorLogo = require("../../assets/images/logo-color-on-navy.png");

/**
 * The photo's fade into the navy over its top and bottom 30%, as the board's
 * mask draws it: navy at the band's edges, clear across its middle.
 */
function NavyFade() {
  return (
    <Svg
      width="100%"
      height="100%"
      style={StyleSheet.absoluteFill}
      preserveAspectRatio="none"
    >
      <Defs>
        <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color.navy} stopOpacity={1} />
          <Stop offset="0.3" stopColor={color.navy} stopOpacity={0} />
          <Stop offset="0.7" stopColor={color.navy} stopOpacity={0} />
          <Stop offset="1" stopColor={color.navy} stopOpacity={1} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#fade)" />
    </Svg>
  );
}

/**
 * The photo fills its band's height and at least its width, right-aligned,
 * as CSS `object-fit: cover` with `object-position: right` would place it.
 */
const heroPhotoSize = ({ width, height }: { width: number; height: number }) =>
  height * heroAspect >= width
    ? { width: height * heroAspect, height }
    : { width, height: width / heroAspect };

/**
 * The navy top of the sign-in screen: the brand, the landing page's photo
 * fading into the navy with the logo die blended over it, and the title.
 */
export function SignInMasthead() {
  const locale = useAppLocale();
  const insets = useSafeAreaInsets();
  const [band, setBand] = useState<{
    top: number;
    width: number;
    height: number;
  }>();
  const onBandLayout = ({ nativeEvent }: LayoutChangeEvent) =>
    setBand({
      top: nativeEvent.layout.y,
      width: nativeEvent.layout.width,
      height: nativeEvent.layout.height,
    });
  const photo = band && heroPhotoSize(band);

  return (
    <View style={[styles.masthead, { paddingTop: insets.top }]}>
      <FocusedStatusBar style="light" />
      <QuietUpdateOffer backdrop="navy" style={styles.updateOffer} />
      <View style={styles.brand}>
        <Image source={colorLogo} style={styles.logo} />
        <View>
          <Text variant="display" tone="inverse" style={styles.wordmark}>
            Deskohub
          </Text>
          <Text variant="hint" style={styles.workspace}>
            WORKSPACE
          </Text>
        </View>
      </View>
      <View style={styles.heroBand} onLayout={onBandLayout} aria-hidden>
        {photo && band && (
          <Image
            source={heroPhoto}
            resizeMode="cover"
            style={[
              styles.photo,
              photo,
              { top: (band.height - photo.height) / 2 },
            ]}
          />
        )}
        <NavyFade />
        {/* The die keeps its place on the masthead (12 below the status
            bar), but blends only over the photo: Android's overlay lightens
            the bare navy, which CSS leaves alone. */}
        {band && (
          <View
            style={[styles.mark, { top: insets.top + space.md - band.top }]}
            pointerEvents="none"
          >
            <LogoMark width={300} color={color.white} />
          </View>
        )}
      </View>
      <View style={styles.titles}>
        <Text
          variant="display"
          tone="inverse"
          role="heading"
          locale={locale}
          style={styles.title}
        >
          {m.signin_create_title({}, { locale })}
        </Text>
        <Text variant="body" locale={locale} style={styles.subtitle}>
          {m.signin_entry_subtitle({}, { locale })}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  masthead: {
    backgroundColor: color.navy,
    flex: 1,
    overflow: "hidden",
  },
  updateOffer: { marginHorizontal: space.lg, marginTop: space.md },
  brand: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: space.xxl,
    paddingTop: space.xl,
  },
  logo: { height: 45, width: 40 },
  wordmark: { fontSize: 20, letterSpacing: -0.2, lineHeight: 20 },
  workspace: {
    color: color.onNavyMuted,
    fontSize: 12,
    letterSpacing: 2.4,
    lineHeight: 12,
    marginTop: 4,
  },
  heroBand: {
    flex: 1,
    marginBottom: space.sm,
    marginTop: space.md,
    minHeight: 0,
    overflow: "hidden",
  },
  // Translucent on the navy. Android fades each child of a translucent view
  // on its own, which would thin the fade too, so only the photo is.
  photo: { opacity: 0.6, position: "absolute", right: 0 },
  mark: {
    mixBlendMode: "overlay",
    opacity: 0.6,
    position: "absolute",
    right: -70,
    zIndex: 1,
  },
  titles: {
    paddingBottom: 28,
    paddingHorizontal: space.xxl,
  },
  title: { fontSize: 34, letterSpacing: -0.6, lineHeight: 40 },
  subtitle: { color: color.onNavyMuted, marginTop: space.md },
});
