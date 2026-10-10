import { afterAll, afterEach, describe, expect, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();

const { Checkbox } = await import("./checkbox");
const { Dialog, DialogContent, DialogDescription, DialogTitle } = await import(
  "./dialog"
);
const { Sheet, SheetContent, SheetDescription, SheetTitle } = await import(
  "./sheet"
);
const { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } =
  await import("./tooltip");

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

describe("interactive primitives", () => {
  test("renders tooltips outside overflow-clipped parents", async () => {
    const view = render(
      <div data-overflow-parent="">
        <TooltipProvider>
          <Tooltip open>
            <TooltipTrigger>Details</TooltipTrigger>
            <TooltipContent>Sale details</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    );

    expect(view.container.textContent).not.toContain("Sale details");
    expect((await view.findByRole("tooltip")).textContent).toContain(
      "Sale details"
    );
  });

  test.each([
    ["focuses the trigger", true],
    ["leaves focus alone", false],
  ] as const)(
    "toggles tooltips with touch taps that %s",
    async (_, focuses) => {
      const view = render(
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>Details</TooltipTrigger>
            <TooltipContent>Sale details</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
      const trigger = view.getByRole("button", { name: "Details" });
      const touch = { isPrimary: true, pointerId: 1, pointerType: "touch" };
      const tap = async (target: HTMLElement) => {
        await act(async () => {
          fireEvent.pointerDown(target, touch);
        });
        await act(async () => {
          fireEvent.pointerUp(target, touch);
        });
        await act(async () => {
          fireEvent.pointerLeave(target, touch);
        });
        // Android emulates focus before the click; iOS does not focus buttons.
        if (focuses) {
          await act(async () => {
            target.focus();
          });
        }
        await act(async () => {
          fireEvent.click(target, { detail: 1 });
        });
        // Let the opened tooltip register its outside-dismissal listeners.
        await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
      };

      await tap(trigger);
      expect((await view.findByRole("tooltip")).textContent).toBe(
        "Sale details"
      );

      await tap(trigger);
      await waitFor(() => expect(view.queryByRole("tooltip")).toBeNull());

      await tap(trigger);
      expect(await view.findByRole("tooltip")).toBeTruthy();

      await tap(document.body);
      await waitFor(() => expect(view.queryByRole("tooltip")).toBeNull());
    }
  );

  test("still dismisses tooltips after a touch gesture without a click", async () => {
    const view = render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Details</TooltipTrigger>
          <TooltipContent>Sale details</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    const trigger = view.getByRole("button", { name: "Details" });
    const touch = { isPrimary: true, pointerId: 1, pointerType: "touch" };

    await act(async () => {
      fireEvent.pointerDown(trigger, touch);
      fireEvent.pointerUp(trigger, touch);
      trigger.focus();
      fireEvent.click(trigger, { detail: 1 });
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(await view.findByRole("tooltip")).toBeTruthy();

    await act(async () => {
      fireEvent.pointerDown(trigger, touch);
      fireEvent.pointerUp(trigger, touch);
      trigger.blur();
    });
    await waitFor(() => expect(view.queryByRole("tooltip")).toBeNull());

    await act(async () => {
      trigger.focus();
    });
    const tooltip = await view.findByRole("tooltip");
    await act(async () => {
      fireEvent.keyDown(tooltip, { key: "Escape" });
    });
    await waitFor(() => expect(view.queryByRole("tooltip")).toBeNull());

    await act(async () => {
      trigger.focus();
      fireEvent.keyDown(trigger, { key: "Enter" });
      fireEvent.click(trigger, { detail: 0 });
    });
    expect(view.queryByRole("tooltip")).toBeNull();
  });

  test("keeps tooltips closed after a mouse click", async () => {
    const view = render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Details</TooltipTrigger>
          <TooltipContent>Sale details</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    const trigger = view.getByRole("button", { name: "Details" });
    const mouse = { isPrimary: true, pointerId: 1, pointerType: "mouse" };

    await act(async () => {
      fireEvent.pointerDown(trigger, mouse);
      trigger.focus();
      fireEvent.pointerUp(trigger, mouse);
      fireEvent.click(trigger, { detail: 1 });
    });

    expect(view.queryByRole("tooltip")).toBeNull();
  });

  test("shows the pointer cursor for enabled checkboxes", () => {
    const view = render(<Checkbox aria-label="Create invoice" />);

    expect(
      view.getByRole("checkbox", { name: "Create invoice" }).className
    ).toContain("cursor-pointer");
  });

  test("localizes the dialog close button", async () => {
    const view = render(
      <Dialog open>
        <DialogContent locale="cs-CZ">
          <DialogTitle>Detail</DialogTitle>
          <DialogDescription>Popis</DialogDescription>
        </DialogContent>
      </Dialog>
    );

    expect(await view.findByRole("button", { name: "Zavřít" })).toBeTruthy();
  });

  test("localizes the sheet close button", async () => {
    const view = render(
      <Sheet open>
        <SheetContent locale="cs-CZ">
          <SheetTitle>Menu</SheetTitle>
          <SheetDescription>Navigace</SheetDescription>
        </SheetContent>
      </Sheet>
    );

    expect(await view.findByRole("button", { name: "Zavřít" })).toBeTruthy();
  });

  test("keeps the English close label for unlocalized dialogs", async () => {
    const view = render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Details</DialogTitle>
          <DialogDescription>Description</DialogDescription>
        </DialogContent>
      </Dialog>
    );

    expect(await view.findByRole("button", { name: "Close" })).toBeTruthy();
  });
});
