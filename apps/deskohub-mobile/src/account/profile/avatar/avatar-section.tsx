import type { CustomerAvatarPresentation } from "@deskohub/workspace-customer-api";
import { useAtom } from "@effect/atom-react";
import Camera from "lucide-react-native/icons/camera";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSettledResultReset } from "../../../customer-api/settled-result-reset";
import { useAppLocale } from "../../../i18n/locale-context";
import { m } from "../../../i18n/messages";
import { ConfirmDialog } from "../../../ui/confirm-dialog";
import { Button } from "../../../ui/controls";
import { Icon } from "../../../ui/icon";
import { Notice } from "../../../ui/notice";
import { useToast } from "../../../ui/toast";
import { color, space } from "../../../ui/tokens";
import { AccountAvatar } from "../../account-avatar";
import {
  avatarActionAtom,
  avatarFeedback,
  isAvatarBusy,
} from "./avatar-action";
import { avatarFeedbackNotice } from "./avatar-feedback-presentation";

// The 38 button plus its 3 ring of canvas colour, cut into the avatar.
const cameraDisc = 44;

/**
 * The account's profile photo, or its initials, centred at the top of the
 * Profile screen, with a camera button and "Change photo" to pick a new one
 * and, once there is a photo, "Remove photo". A finished change or removal
 * confirms in a toast; progress and problems show in a notice under it.
 * Renders nothing while the release withholds avatars, including once the
 * Workspace answers that it does.
 */
export function AvatarSection({
  avatar,
  initials,
}: {
  readonly avatar: CustomerAvatarPresentation;
  readonly initials: string;
}) {
  const locale = useAppLocale();
  const toast = useToast();
  const [result, run] = useAtom(avatarActionAtom, { mode: "promiseExit" });
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  // The next visit starts without the last confirmation.
  useSettledResultReset(avatarActionAtom);
  const feedback = avatarFeedback(result);
  const busy = isAvatarBusy(feedback);
  const notice = avatarFeedbackNotice(feedback, locale);
  const confirmed = feedback._tag === "Updated" || feedback._tag === "Removed";

  useEffect(() => {
    if (confirmed && notice.message !== undefined)
      toast.show({ message: notice.message });
  }, [confirmed, notice.message, toast]);

  if (avatar.kind === "hidden" || feedback._tag === "Withheld") return null;
  const image = avatar.avatar;
  const changeLabel =
    image === null
      ? m.profile_avatar_add({}, { locale })
      : m.profile_avatar_change({}, { locale });
  const change = () => void run("change");

  return (
    <View style={styles.section}>
      <View style={styles.avatar}>
        <AccountAvatar
          size="large"
          tone="on-paper"
          initials={initials}
          {...(image !== null && { photoUrl: image.url })}
        />
        <Pressable
          role="button"
          aria-label={changeLabel}
          disabled={busy}
          onPress={change}
          style={({ pressed }) => [
            styles.camera,
            pressed && styles.cameraPressed,
          ]}
        >
          <Icon icon={Camera} size={20} color={color.action} />
        </Pressable>
      </View>
      <View style={styles.actions}>
        <Button
          variant="text"
          size="small"
          width="content"
          label={changeLabel}
          onPress={change}
          disabled={busy}
        />
        {image !== null && (
          <Button
            variant="dangerText"
            size="small"
            width="content"
            label={m.profile_avatar_remove({}, { locale })}
            onPress={() => setConfirmingRemoval(true)}
            disabled={busy}
          />
        )}
      </View>
      <View style={styles.notice}>
        <Notice
          tone={notice.tone}
          message={confirmed ? undefined : notice.message}
        />
      </View>
      <ConfirmDialog
        visible={confirmingRemoval}
        title={m.profile_avatar_remove_title({}, { locale })}
        body={m.profile_avatar_remove_body({}, { locale })}
        confirmLabel={m.profile_avatar_remove({}, { locale })}
        cancelLabel={m.account_cancel({}, { locale })}
        destructive
        busy={feedback._tag === "Removing"}
        busyMessage={m.profile_avatar_removing({}, { locale })}
        onConfirm={() =>
          void run("remove").then(() => setConfirmingRemoval(false))
        }
        onCancel={() => setConfirmingRemoval(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { alignItems: "center", gap: space.xs, paddingTop: space.xs },
  avatar: { height: 88, width: 88 },
  camera: {
    alignItems: "center",
    backgroundColor: color.actionTint,
    borderColor: color.paper,
    borderRadius: cameraDisc / 2,
    borderWidth: 3,
    bottom: -4,
    height: cameraDisc,
    justifyContent: "center",
    position: "absolute",
    right: -12,
    width: cameraDisc,
  },
  cameraPressed: { backgroundColor: color.sunken },
  actions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  notice: { alignSelf: "stretch" },
});
