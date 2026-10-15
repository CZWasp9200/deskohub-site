import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { audienceAttributeCatalogue } from "@deskohub/workspace-admin-api";
import { Result, Schema } from "effect";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  type AudienceCondition,
  audienceFilterSchema,
} from "../../audience-filter";
import { newCondition } from "./audience-filter-editing";

registerWorkspaceComponentTestEnv();
// @testing-library/react must load after the happy-dom registration.
const { cleanup, render } = await import("@testing-library/react");
const { CountConditionControls } = await import(
  "./audience-condition-controls"
);

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

/** The form's lookup: each issue's message at its path below the condition. */
const formErrors = (input: AudienceCondition) => {
  const result =
    Schema.toStandardSchemaV1(audienceFilterSchema)["~standard"].validate(
      input
    );
  const issues = "issues" in result ? (result.issues ?? []) : [];
  return (field: string) =>
    issues.find(({ path }) => (path ?? []).join(".") === field)?.message;
};

describe("CountConditionControls", () => {
  test.each([
    ["lt", "“< 0” never matches. Use “= 0” for none."],
    [
      "gte",
      "“≥ 0” always matches. Use “≥ 1” for any, or remove the condition.",
    ],
  ] as const)("explains why “%s 0” is rejected", (operator, message) => {
    const condition = {
      ...newCondition("campaignEmailCount"),
      operator,
      value: 0,
    } as const;
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(audienceFilterSchema)(condition)
      )
    ).toBe(true);
    const view = render(
      <CountConditionControls
        entry={audienceAttributeCatalogue.campaignEmailCount}
        value={condition}
        onChange={() => undefined}
        errorAt={formErrors(condition)}
      />
    );
    expect(view.getByRole("alert").textContent).toBe(message);
  });
});
