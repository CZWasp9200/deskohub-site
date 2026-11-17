import type { ReactNode } from "react";
import { Button, LiveMessage } from "./controls";
import { Dialog } from "./dialog";

/** The two buttons' looks and order for each kind of confirmation. */
const actionLook = (destructive: boolean, irreversible: boolean) => {
  if (irreversible)
    return {
      confirm: "danger",
      cancel: "secondary",
      cancelFirst: false,
    } as const;
  if (destructive)
    return {
      confirm: "dangerText",
      cancel: "primary",
      cancelFirst: true,
    } as const;
  return { confirm: "primary", cancel: "quiet", cancelFirst: false } as const;
};

/**
 * Asks the customer to confirm an action before it runs. A destructive
 * confirmation leads with the safe way out (the primary cancel) and puts the
 * crimson confirm below it; any other leads with the primary confirm and a
 * quiet cancel. While `busy`, the confirm shows its progress, cancel is
 * disabled and the dialog can't be dismissed (back button or scrim), so the
 * action's outcome stays on screen; `busyMessage` is announced meanwhile.
 */
export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  destructive = false,
  irreversible = false,
  busy = false,
  busyMessage,
  children,
}: {
  readonly visible: boolean;
  readonly title: string;
  /** What happens if they confirm, when the title alone doesn't say. */
  readonly body?: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  /**
   * The confirmation is the dialog's point and can't be undone (boards 15
   * and 18): a filled danger button first, Cancel outlined under it. A
   * `destructive` one alone keeps the safe choice primary (board 00e).
   */
  readonly irreversible?: boolean;
  readonly destructive?: boolean;
  readonly busy?: boolean;
  readonly busyMessage?: string;
  /** Content between the body and the actions, such as a field or the last attempt's failure. */
  readonly children?: ReactNode;
}) {
  const dismiss = () => {
    if (!busy) onCancel();
  };
  const look = actionLook(destructive, irreversible);
  const confirm = (
    <Button
      key="confirm"
      variant={look.confirm}
      label={confirmLabel}
      onPress={onConfirm}
      busy={busy}
    />
  );
  const cancel = (
    <Button
      key="cancel"
      variant={look.cancel}
      label={cancelLabel}
      onPress={onCancel}
      disabled={busy}
    />
  );
  return (
    <Dialog
      visible={visible}
      role="alertdialog"
      title={title}
      body={body}
      busy={busy}
      onDismiss={dismiss}
      actions={[
        ...(destructive && !irreversible
          ? [cancel, confirm]
          : [confirm, cancel]),
        <LiveMessage
          key="progress"
          role="status"
          message={busy ? busyMessage : undefined}
        />,
      ]}
    >
      {children}
    </Dialog>
  );
}
