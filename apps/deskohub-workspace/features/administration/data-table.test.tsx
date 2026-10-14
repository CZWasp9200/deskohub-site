import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { AdministrationDataTable } from "./data-table";

describe("AdministrationDataTable", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("orders numbered text naturally and keeps one sort applied", () => {
    const view = render(
      <AdministrationDataTable
        ariaLabel="Codes"
        columns={[{ accessorKey: "code", header: "Code" }]}
        data={[
          { id: "10", code: "Code 10" },
          { id: "2", code: "Code 2" },
          { id: "1", code: "Code 1" },
        ]}
        getRowId={(item) => item.id}
      />
    );
    const table = view.getByRole("table", { name: "Codes" });
    const sort = within(table).getByRole("button", { name: "Code" });
    const codes = () =>
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.textContent);

    fireEvent.click(sort);
    expect(codes()).toEqual(["Code 1", "Code 2", "Code 10"]);

    fireEvent.click(sort);
    expect(sort.closest("th")?.getAttribute("aria-sort")).toBe("descending");
    expect(codes()).toEqual(["Code 10", "Code 2", "Code 1"]);

    fireEvent.click(sort);
    expect(sort.closest("th")?.getAttribute("aria-sort")).toBe("ascending");
  });
});
