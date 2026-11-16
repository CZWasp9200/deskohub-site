import User from "lucide-react-native/icons/user";
import { Image, StyleSheet, View } from "react-native";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { Icon } from "../ui/icon";
import { Text } from "../ui/text";
import { color } from "../ui/tokens";

/** The avatar on the navy masthead (white disc) or on the paper canvas (navy disc). */
export type AccountAvatarTone = "on-navy" | "on-paper";

const sizes = {
  regular: { disc: 56, initials: "dialogTitle", icon: 26 },
  large: { disc: 88, initials: "display", icon: 32 },
} as const;

const tones = {
  "on-navy": { disc: color.white, ink: color.navy },
  "on-paper": { disc: color.navy, ink: color.white },
} as const satisfies Record<
  AccountAvatarTone,
  { readonly disc: string; readonly ink: string }
>;

/**
 * The account's profile photo in a circle, else its initials, else (before
 * the profile exists) a person icon.
 */
export function AccountAvatar({
  photoUrl,
  initials,
  size = "regular",
  tone,
}: {
  readonly photoUrl?: string;
  readonly initials?: string;
  readonly size?: keyof typeof sizes;
  readonly tone: AccountAvatarTone;
}) {
  const locale = useAppLocale();
  const dimensions = sizes[size];
  const disc = {
    backgroundColor: tones[tone].disc,
    borderRadius: dimensions.disc / 2,
    height: dimensions.disc,
    width: dimensions.disc,
  };
  if (photoUrl !== undefined)
    return (
      <Image
        source={{ uri: photoUrl }}
        alt={m.profile_avatar_image_label({}, { locale })}
        style={disc}
      />
    );
  return (
    <View
      role="img"
      aria-label={
        initials === undefined
          ? undefined
          : m.profile_avatar_initials_label({}, { locale })
      }
      aria-hidden={initials === undefined}
      style={[styles.disc, disc]}
    >
      {initials === undefined ? (
        <Icon icon={User} size={dimensions.icon} color={tones[tone].ink} />
      ) : (
        <Text
          aria-hidden
          variant={dimensions.initials}
          // The disc keeps its size, so its initials can't grow past it.
          maxFontSizeMultiplier={1.15}
          style={[styles.initials, { color: tones[tone].ink }]}
        >
          {initials}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  disc: { alignItems: "center", justifyContent: "center" },
  initials: { letterSpacing: 0.5 },
});
