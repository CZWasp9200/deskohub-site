import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import "@/shared/polyfills/temporal";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

// Radix picks its layout-effect hook when it loads, so the DOM must exist
// before the picker is imported for the popover portal to mount.
registerWorkspaceComponentTestEnv();

const { ReservationDatePicker } = await import("./reservation-date-picker");

describe("ReservationDatePicker", () => {
  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("reports a blur when the calendar closes so onBlur validation runs", async () => {
    const onBlur = mock(() => undefined);
    const view = render(
      <ReservationDatePicker
        ariaLabel="Date"
        onBlur={onBlur}
        value="2099-06-10"
      />
    );
    const trigger = view.getByRole("button", { name: "Date" });

    act(() => {
      fireEvent.click(trigger);
    });
    await waitFor(() => {
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
    });
    expect(onBlur).not.toHaveBeenCalled();

    act(() => {
      fireEvent.click(trigger);
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  test("opens the popover only with the calendar already rendered", async () => {
    const openedWithoutCalendar: Array<string> = [];
    const observer = new MutationObserver(() => {
      for (const dialog of document.body.querySelectorAll('[role="dialog"]')) {
        if (!dialog.querySelector('[role="grid"]')) {
          openedWithoutCalendar.push(dialog.outerHTML);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const view = render(
      <ReservationDatePicker ariaLabel="Date" value="2099-06-10" />
    );
    const trigger = view.getByRole("button", { name: "Date" });

    await act(async () => fireEvent.click(trigger));
    const dialog = await within(document.body).findByRole("dialog");

    observer.disconnect();
    expect(within(dialog).getByRole("grid")).toBeTruthy();
    expect(openedWithoutCalendar).toEqual([]);
  });
});
