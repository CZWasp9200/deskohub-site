import { describe, expect, test } from "bun:test";
import {
  Children,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { ConfirmDialog } from "./confirm-dialog";
import { Button, LiveMessage } from "./controls";
import { Dialog } from "./dialog";
import { elementTree, find, hostTree } from "./testing/element-tree";

type ConfirmProps = Parameters<typeof ConfirmDialog>[0];

const confirmDialog = (props: Partial<ConfirmProps> = {}) =>
  elementTree(ConfirmDialog, {
    visible: true,
    title: "title",
    body: "body",
    confirmLabel: "confirm",
    cancelLabel: "cancel",
    onConfirm: () => undefined,
    onCancel: () => undefined,
    ...props,
  }) as ReactElement<Parameters<typeof Dialog>[0]>;

const dialog = (children?: ReactNode) => hostTree(confirmDialog({ children }));

/** The dialog's buttons in order, by label. */
const buttons = (props: Partial<ConfirmProps> = {}) =>
  Children.toArray(confirmDialog(props).props.actions)
    .filter(
      (action): action is ReactElement<Parameters<typeof Button>[0]> =>
        isValidElement(action) && action.type === Button
    )
    .map((button) => button.props);

describe("ConfirmDialog", () => {
  test("its content follows the body inside the scroll area", () => {
    const content = createElement("DialogContent");
    const scroll = find(dialog(content), "ScrollView");
    const copy = Children.toArray(scroll?.props.children);
    expect(copy).toHaveLength(3);
    expect(isValidElement(copy[2]) && copy[2].type).toBe("DialogContent");
  });

  test("without content the scroll area holds the title and body only", () => {
    const scroll = find(dialog(), "ScrollView");
    expect(Children.toArray(scroll?.props.children)).toHaveLength(2);
  });

  test("is an alert dialog", () => {
    expect(confirmDialog().type).toBe(Dialog);
    expect(confirmDialog().props.role).toBe("alertdialog");
  });

  test("a destructive confirmation leads with the safe primary cancel, the crimson confirm below", () => {
    expect(
      buttons({ destructive: true }).map(({ label, variant }) => [
        label,
        variant,
      ])
    ).toEqual([
      ["cancel", "primary"],
      ["confirm", "dangerText"],
    ]);
  });

  test("an irreversible confirmation leads with a filled danger confirm, an outlined cancel below", () => {
    expect(
      buttons({ destructive: true, irreversible: true }).map(
        ({ label, variant }) => [label, variant]
      )
    ).toEqual([
      ["confirm", "danger"],
      ["cancel", "secondary"],
    ]);
  });

  test("any other confirmation leads with the primary confirm and a quiet cancel", () => {
    expect(buttons().map(({ label, variant }) => [label, variant])).toEqual([
      ["confirm", "primary"],
      ["cancel", "quiet"],
    ]);
  });

  test("while busy the confirm shows its progress, cancel is disabled and nothing dismisses", () => {
    const cancels: string[] = [];
    const props = {
      busy: true,
      busyMessage: "working",
      onCancel: () => cancels.push("cancel"),
    };
    const [confirm, cancel] = buttons(props);
    expect(confirm?.busy).toBe(true);
    expect(cancel?.disabled).toBe(true);
    const busyDialog = confirmDialog(props);
    expect(busyDialog.props.busy).toBe(true);
    busyDialog.props.onDismiss();
    expect(cancels).toEqual([]);
    const progress = find(
      Children.toArray(busyDialog.props.actions).at(-1),
      LiveMessage
    )?.props;
    expect(progress).toEqual({ role: "status", message: "working" });
  });

  test("when idle, dismissing cancels and the progress region stays mounted but empty", () => {
    const cancels: string[] = [];
    const idle = confirmDialog({
      busyMessage: "working",
      onCancel: () => cancels.push("cancel"),
    });
    idle.props.onDismiss();
    expect(cancels).toEqual(["cancel"]);
    expect(
      find(Children.toArray(idle.props.actions).at(-1), LiveMessage)?.props
        .message
    ).toBeUndefined();
  });
});
