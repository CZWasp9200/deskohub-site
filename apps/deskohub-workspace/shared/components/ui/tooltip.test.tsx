import { afterAll, afterEach, expect, jest, test } from "bun:test";
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

const { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } =
  await import("./tooltip");

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});
afterAll(unregisterWorkspaceComponentTestEnv);

test("keeps a touch-tapped tooltip open through later touch moves until tapped again", async () => {
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
  const tap = async () => {
    await act(async () => {
      fireEvent.pointerDown(trigger, touch);
      trigger.focus();
      fireEvent.pointerMove(trigger, touch);
      fireEvent.pointerUp(trigger, touch);
      fireEvent.click(trigger, { detail: 1 });
      fireEvent.pointerLeave(trigger, touch);
    });
  };

  await tap();
  const tooltip = await view.findByRole("tooltip");
  expect(tooltip.textContent).toBe("Sale details");
  expect(trigger.getAttribute("aria-describedby")).toBe(tooltip.id);

  // Fake timers run any close delay a later touch move would schedule.
  jest.useFakeTimers();
  act(() => {
    fireEvent.pointerMove(trigger, touch);
    jest.advanceTimersByTime(1000);
  });
  jest.useRealTimers();
  expect(view.getByRole("tooltip").textContent).toBe("Sale details");

  await tap();
  await waitFor(() => expect(view.queryByRole("tooltip")).toBeNull());
});
