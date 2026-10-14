import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  ReservationTypeInput,
  ReservationTypeOption,
} from "./reservation-type-input";

describe("ReservationTypeInput", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("keeps native radio behavior when illustrated presentation is enabled", () => {
    const onChange = mock(() => undefined);
    const view = render(
      <ReservationTypeInput
        aria-required="true"
        idPrefix="cowork-tier"
        name="entryTier"
        onChange={onChange}
        presentation="illustrated"
        value="open-space"
      >
        <ReservationTypeOption
          price="CZK 290 / day"
          title="Open Space"
          value="open-space"
        />
        <ReservationTypeOption
          price="CZK 410 / day"
          title="Reserved Desk"
          value="reserved-desk"
        />
        <ReservationTypeOption
          disabled
          price="CZK 410 / day"
          title="Workstation"
          value="workstation"
        />
      </ReservationTypeInput>
    );
    const openSpace = view.container.querySelector(
      "#cowork-tier-open-space"
    ) as HTMLInputElement;
    const reservedDesk = view.container.querySelector(
      "#cowork-tier-reserved-desk"
    ) as HTMLInputElement;
    const workstation = view.container.querySelector(
      "#cowork-tier-workstation"
    ) as HTMLInputElement;

    const radioGroup = view.getByRole("radiogroup");
    expect(radioGroup.getAttribute("data-reservation-type-presentation")).toBe(
      "illustrated"
    );
    expect(radioGroup.getAttribute("aria-required")).toBe("true");
    expect(openSpace.name).toBe("entryTier");
    expect(openSpace.checked).toBe(true);
    expect(reservedDesk.disabled).toBe(false);
    expect(workstation.disabled).toBe(true);

    fireEvent.click(workstation);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(reservedDesk);
    expect(onChange).toHaveBeenCalledWith("reserved-desk");
  });
});
