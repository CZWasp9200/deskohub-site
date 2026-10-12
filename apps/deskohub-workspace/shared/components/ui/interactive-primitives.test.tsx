import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();

const { Dialog, DialogContent, DialogDescription, DialogTitle } = await import(
  "./dialog"
);
const { Sheet, SheetContent, SheetDescription, SheetTitle } = await import(
  "./sheet"
);

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

describe("interactive primitives", () => {
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
