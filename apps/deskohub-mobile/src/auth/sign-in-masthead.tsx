import { useState } from "react";
import { Image, type LayoutChangeEvent, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { FocusedStatusBar } from "../ui/focused-status-bar";
import { LogoMark } from "../ui/logo-mark";
import { Text } from "../ui/text";
import { color, space } from "../ui/tokens";

// The landing page's hero photo with its left 40% (the kitchen) cut off,
// 1080 x 1012, about 93 KB.
const heroPhoto = require("../../assets/images/sign-in-hero.jpg");
const heroAspect = 1080 / 1012;
const colorLogo = require("../../assets/images/logo-color-on-navy.png");

const navyFade = (direction: "to bottom" | "to top") =>
  `linear-gradient(${direction}, ${color.navy}, rgba(0, 2, 79, 0))`;

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
  const [band, setBand] = useState<{ width: number; height: number }>();
  const onBandLayout = ({ nativeEvent }: LayoutChangeEvent) =>
    setBand({
      width: nativeEvent.layout.width,
      height: nativeEvent.layout.height,
    });
  const photo = band && heroPhotoSize(band);

  return (
    <View style={[styles.masthead, { paddingTop: insets.top }]}>
      <FocusedStatusBar style="light" />
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
        <View style={[styles.fade, styles.fadeTop]} />
        <View style={[styles.fade, styles.fadeBottom]} />
      </View>
      <View
        style={[styles.mark, { top: insets.top + space.md }]}
        pointerEvents="none"
      >
        <LogoMark width={300} color={color.white} />
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
    opacity: 0.6,
    overflow: "hidden",
  },
  photo: { position: "absolute", right: 0 },
  // The photo fades into the navy over its top and bottom 30%.
  fade: { height: "30%", left: 0, position: "absolute", right: 0 },
  fadeTop: { backgroundImage: navyFade("to bottom"), top: 0 },
  fadeBottom: { backgroundImage: navyFade("to top"), bottom: 0 },
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
