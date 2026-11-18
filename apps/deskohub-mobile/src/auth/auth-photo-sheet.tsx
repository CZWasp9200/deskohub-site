import CircleAlert from "lucide-react-native/icons/circle-alert";
import type { ReactNode } from "react";
import { Image, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { FocusedStatusBar } from "../ui/focused-status-bar";
import { Icon } from "../ui/icon";
import { useLiveRegionAnnouncement } from "../ui/live-announcement";
import { LogoMark } from "../ui/logo-mark";
import { Text } from "../ui/text";
import { color, radius, space, typeScale } from "../ui/tokens";
import { useViewport } from "../ui/viewport";
import { SignInBrand, signInHeroPhoto, signInTitleStyle } from "./sign-in-art";

const columnWidth = 520;
const panelPadding = 48;
const panelGutter = 64;
const alertTileSize = 56;
const bodyMeasure = 26 * typeScale.body.fontSize;

export function AuthPhotoSheet({
  title,
  body,
  alert = false,
  compactMasthead,
  updateOffer,
  children,
}: {
  readonly title: string;
  readonly body: string;
  readonly alert?: boolean;
  readonly compactMasthead?: ReactNode;
  readonly updateOffer?: ReactNode;
  readonly children: ReactNode;
}) {
  const { fontScale, isWide, isExpanded } = useViewport();
  const insets = useSafeAreaInsets();
  const gutter = Math.max(insets.left, insets.right);
  const announcement = alert ? `${title}. ${body}` : undefined;
  useLiveRegionAnnouncement(announcement, "assertive");

  // Keep the scroll view and action children mounted across width changes.
  // Remounting the passkey option would interrupt an in-progress ceremony.
  return (
    <View style={[styles.page, isWide && styles.photoPage]}>
      {isWide && (
        <View aria-hidden pointerEvents="none" style={styles.backdrop}>
          <Image
            source={signInHeroPhoto}
            resizeMode="cover"
            style={styles.photo}
          />
          <Svg
            width="100%"
            height="100%"
            preserveAspectRatio="none"
            style={StyleSheet.absoluteFill}
          >
            <Defs>
              <LinearGradient id="auth-photo-shade" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={color.navy} stopOpacity={0.45} />
                <Stop offset="0.28" stopColor={color.navy} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#auth-photo-shade)" />
          </Svg>
          <View style={[styles.mark, isExpanded && styles.expandedMark]}>
            <LogoMark width={isExpanded ? 520 : 460} color={color.white} />
          </View>
        </View>
      )}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        bounces={false}
      >
        {isWide ? (
          <View
            style={[
              styles.hero,
              {
                paddingTop: insets.top + (isExpanded ? 40 : 28),
                paddingHorizontal: gutter + space.xxl,
              },
              isExpanded && {
                paddingLeft: insets.left + panelGutter + panelPadding,
              },
            ]}
          >
            <FocusedStatusBar style="light" />
            <View style={[styles.column, isExpanded && styles.expandedBrand]}>
              {updateOffer}
              <SignInBrand />
            </View>
          </View>
        ) : (
          compactMasthead
        )}
        <View
          style={
            isWide
              ? [
                  styles.sheet,
                  {
                    paddingBottom: insets.bottom + 40,
                    paddingHorizontal: gutter + space.xxl,
                  },
                  isExpanded && {
                    marginLeft: insets.left + panelGutter,
                    paddingHorizontal: panelPadding,
                    paddingTop: panelPadding,
                    width: columnWidth + 2 * panelPadding,
                  },
                ]
              : undefined
          }
        >
          <View
            style={isWide ? [styles.column, styles.sheetContent] : undefined}
          >
            {isWide && (
              <View style={styles.heading}>
                {alert && (
                  <View style={styles.alertTile}>
                    <Icon
                      icon={CircleAlert}
                      size={28}
                      color={color.dangerInk}
                    />
                  </View>
                )}
                <View style={styles.headingText}>
                  <View style={alert ? styles.alertTitle : undefined}>
                    <Text
                      role={alert ? "alert" : "heading"}
                      aria-level={alert ? undefined : 1}
                      aria-live={alert ? "assertive" : undefined}
                      accessibilityLiveRegion={alert ? "assertive" : undefined}
                      accessibilityLabel={announcement}
                      variant="display"
                      tone={alert ? "danger" : undefined}
                      style={signInTitleStyle}
                    >
                      {title}
                    </Text>
                  </View>
                  <Text
                    variant="body"
                    tone="muted"
                    style={{ maxWidth: bodyMeasure * fontScale }}
                  >
                    {body}
                  </Text>
                </View>
              </View>
            )}
            {children}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: color.paper, flex: 1 },
  photoPage: { backgroundColor: color.navy },
  backdrop: { ...StyleSheet.absoluteFill, overflow: "hidden" },
  photo: { width: "100%", height: "100%", opacity: 0.6 },
  mark: {
    mixBlendMode: "overlay",
    opacity: 0.5,
    position: "absolute",
    right: -120,
    top: 20,
  },
  expandedMark: { right: -100, top: -20 },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  hero: { flexGrow: 1, paddingBottom: space.xxxl },
  column: { alignSelf: "center", maxWidth: columnWidth, width: "100%" },
  expandedBrand: { alignSelf: "flex-start" },
  sheet: {
    alignSelf: "flex-start",
    backgroundColor: color.paper,
    borderTopLeftRadius: radius.overlay,
    borderTopRightRadius: radius.overlay,
    paddingTop: 44,
    width: "100%",
  },
  sheetContent: { gap: 28 },
  heading: { flexDirection: "row", gap: space.lg },
  headingText: { flex: 1, gap: space.md },
  alertTitle: { minHeight: alertTileSize, justifyContent: "center" },
  alertTile: {
    alignItems: "center",
    backgroundColor: color.dangerTint,
    borderRadius: radius.tile,
    height: alertTileSize,
    justifyContent: "center",
    width: alertTileSize,
  },
});
