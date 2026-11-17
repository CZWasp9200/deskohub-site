import EllipsisVertical from "lucide-react-native/icons/ellipsis-vertical";
import KeyRound from "lucide-react-native/icons/key-round";
import { Icon } from "../../ui/icon";
import { ListRow } from "../../ui/list";
import { color } from "../../ui/tokens";

/**
 * One passkey: its name over its provider and creation date. The whole row
 * is the button that opens its menu (Rename, Delete), so assistive
 * technology reaches the menu as one element; the ⋮ only shows that a
 * menu is there.
 */
export function PasskeyListRow({
  name,
  details,
  menuLabel,
  disabled,
  onOpenMenu,
}: {
  readonly name: string;
  readonly details: string | undefined;
  /** What the row reads: the menu it opens, named after the passkey. */
  readonly menuLabel: string;
  readonly disabled: boolean;
  readonly onOpenMenu: () => void;
}) {
  return (
    <ListRow
      kind="action"
      icon={KeyRound}
      label={name}
      description={details}
      trailing={<Icon icon={EllipsisVertical} size={20} color={color.navy} />}
      accessibilityLabel={
        details === undefined ? menuLabel : `${menuLabel}, ${details}`
      }
      disabled={disabled}
      onPress={onOpenMenu}
    />
  );
}
