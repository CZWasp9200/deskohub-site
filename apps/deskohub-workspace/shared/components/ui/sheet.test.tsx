import { afterAll, afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();

const { buttonVariants } = await import("./button");
const { Sheet, SheetContent, SheetDescription, SheetTitle } = await import(
  "./sheet"
);

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

test("the close action is a muted ghost icon Button named for the locale", () => {
  const openChanges: boolean[] = [];
  const view = render(
    <Sheet onOpenChange={(open) => openChanges.push(open)} open>
      <SheetContent locale="cs-CZ">
        <SheetTitle>Menu</SheetTitle>
        <SheetDescription>Navigace webu.</SheetDescription>
      </SheetContent>
    </Sheet>
  );
  const close = view.getByRole("button", {
    name: m.closeDialogLabel({}, { locale: "cs-CZ" }),
  });

  expect(close.getAttribute("type")).toBe("button");
  expect(close.className.split(" ")).toEqual(
    expect.arrayContaining(
      buttonVariants({
        size: "icon-sm",
        tone: "muted",
        variant: "ghost",
      }).split(" ")
    )
  );

  fireEvent.click(close);
  expect(openChanges).toEqual([false]);
});

const renderSwipeableSheet = (onSwipeDismiss: () => void) => {
  const view = render(
    <Sheet open>
      <SheetContent
        locale="cs-CZ"
        onSwipeDismiss={onSwipeDismiss}
        side="bottom"
      >
        <SheetTitle>Menu</SheetTitle>
        <SheetDescription>Navigace webu.</SheetDescription>
      </SheetContent>
    </Sheet>
  );
  const handle = view
    .getByRole("dialog")
    .querySelector<HTMLElement>("[class*='cursor-grab']");
  if (!handle) throw new Error("The sheet has no grab handle.");
  return handle;
};

const swipe = (handle: HTMLElement, distance: number) => {
  fireEvent.pointerDown(handle, { button: 0, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientY: 100 + distance, pointerId: 1 });
  fireEvent.pointerUp(handle, { clientY: 100 + distance, pointerId: 1 });
};

test("a bottom sheet swiped down from its handle past the threshold dismisses itself", async () => {
  const dismissals: string[] = [];
  swipe(
    renderSwipeableSheet(() => dismissals.push("dismissed")),
    160
  );

  await new Promise((resolve) => setTimeout(resolve, 260));
  expect(dismissals).toEqual(["dismissed"]);
});

test("a short, slow swipe springs the sheet back without dismissing it", async () => {
  const dismissals: string[] = [];
  const handle = renderSwipeableSheet(() => dismissals.push("dismissed"));
  fireEvent.pointerDown(handle, { button: 0, clientY: 100, pointerId: 1 });
  await new Promise((resolve) => setTimeout(resolve, 200));
  fireEvent.pointerUp(handle, { clientY: 120, pointerId: 1 });

  await new Promise((resolve) => setTimeout(resolve, 260));
  expect(dismissals).toEqual([]);
});

test("a sheet without a swipe handler has no grab handle", () => {
  const view = render(
    <Sheet open>
      <SheetContent locale="cs-CZ" side="bottom">
        <SheetTitle>Menu</SheetTitle>
        <SheetDescription>Navigace webu.</SheetDescription>
      </SheetContent>
    </Sheet>
  );

  expect(
    view.getByRole("dialog").querySelector("[class*='cursor-grab']")
  ).toBeNull();
});
