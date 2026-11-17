import Bot from "lucide-react-native/icons/bot";
import CalendarCheck from "lucide-react-native/icons/calendar-check";
import CalendarPlus from "lucide-react-native/icons/calendar-plus";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import CircleCheck from "lucide-react-native/icons/circle-check";
import CircleUser from "lucide-react-native/icons/circle-user";
import Gift from "lucide-react-native/icons/gift";
import Key from "lucide-react-native/icons/key";
import Lock from "lucide-react-native/icons/lock";
import Mail from "lucide-react-native/icons/mail";
import ReceiptText from "lucide-react-native/icons/receipt-text";
import Shield from "lucide-react-native/icons/shield";
import Trash2 from "lucide-react-native/icons/trash-2";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import WifiOff from "lucide-react-native/icons/wifi-off";
import { StyleSheet, View } from "react-native";
import { Icon } from "../icon";
import { LoadingIndicator } from "../loading-indicator";
import { Text } from "../text";
import { color, radius, space, type TypeVariant } from "../tokens";
import { GalleryCase, GallerySection, useSample } from "./gallery-kit";

const typeSteps: ReadonlyArray<TypeVariant> = [
  "display",
  "titleLarge",
  "title",
  "headline",
  "body",
  "bodyStrong",
  "bodySmall",
  "label",
  "hint",
  "caption",
];

const icons = {
  Mail,
  Key,
  Lock,
  Shield,
  CircleUser,
  CalendarCheck,
  CalendarPlus,
  ReceiptText,
  Gift,
  Bot,
  Trash2,
  CircleAlert,
  CircleCheck,
  TriangleAlert,
  WifiOff,
};

/** Board 00b: the palette, the type scale, icons and the loading indicator. */
export function FoundationSection() {
  const sample = useSample();
  return (
    <GallerySection title="Colour, type and icons">
      <GalleryCase label="Palette">
        <View style={styles.swatches}>
          {Object.entries(color).map(([name, value]) => (
            <View key={name} style={styles.swatch}>
              <View style={[styles.chip, { backgroundColor: value }]} />
              <Text variant="caption">{name}</Text>
            </View>
          ))}
        </View>
      </GalleryCase>
      <GalleryCase label="Type scale (Sculpin)">
        {typeSteps.map((variant) => (
          <Text key={variant} variant={variant}>
            {`${variant}: ${sample("Rezervace a přihlášení")}`}
          </Text>
        ))}
      </GalleryCase>
      <GalleryCase label="Text tones" surface="white">
        {(
          [
            "default",
            "muted",
            "subtle",
            "action",
            "danger",
            "positive",
            "warning",
          ] as const
        ).map((tone) => (
          <Text key={tone} variant="bodySmall" tone={tone}>
            {`${tone}: ${sample("Supporting text")}`}
          </Text>
        ))}
      </GalleryCase>
      <GalleryCase label="Lucide icons, 24 and 20">
        <View style={styles.icons}>
          {Object.entries(icons).map(([name, glyph], index) => (
            <Icon key={name} icon={glyph} size={index % 2 ? 20 : 24} />
          ))}
        </View>
      </GalleryCase>
      <GalleryCase label="Loading indicator: inline, section, screen">
        <View style={styles.loading}>
          <LoadingIndicator size="inline" tone="navy" />
          <LoadingIndicator size="section" tone={{ color: color.action }} />
          <LoadingIndicator size="screen" tone="brand" label="Loading" />
        </View>
      </GalleryCase>
      <GalleryCase label="Loading indicator on navy" surface="navy">
        <LoadingIndicator size="inline" tone="white" />
      </GalleryCase>
    </GallerySection>
  );
}

const styles = StyleSheet.create({
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  swatch: { alignItems: "center", gap: space.xs, width: 76 },
  chip: {
    borderColor: color.line,
    borderRadius: radius.tile,
    borderWidth: 1,
    height: 40,
    width: 64,
  },
  icons: { flexDirection: "row", flexWrap: "wrap", gap: space.lg },
  loading: { alignItems: "flex-end", flexDirection: "row", gap: space.xxl },
});
