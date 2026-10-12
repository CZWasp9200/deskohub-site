import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("@deskohub/cloudinary-image", () => ({
  CloudinaryImage: () => null,
}));

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

test("presents the existing team profiles under one page heading", async () => {
  const { TeamPage } = await import("./team-page");
  const locale = "en-US";
  const view = render(<TeamPage locale={locale} />);

  expect(view.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(
    view.getByRole("heading", {
      level: 1,
      name: m.landingFoundersTitle({}, { locale }),
    })
  ).toBeTruthy();
  expect(
    view
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent)
  ).toEqual([
    m.landingFounderDanicaRole({}, { locale }),
    m.landingFounderFilipRole({}, { locale }),
    m.landingFounderHardwareRole({}, { locale }),
  ]);
  expect(view.getByText("Danica")).toBeTruthy();
  expect(view.getByText("Filip")).toBeTruthy();
});
