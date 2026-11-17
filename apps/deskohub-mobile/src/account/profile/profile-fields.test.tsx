import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { sampleProfile } from "../../customer-api/testing/sample-fixtures";
import { elementTree } from "../../ui/testing/element-tree";
import {
  type CompletionTextField,
  identityFields,
  type ProfileDraftInvalid,
  profileDraftOf,
} from "./profile-draft";
import { type FocusableField, ProfileTextFields } from "./profile-fields";

type FieldProps = {
  readonly label: string;
  readonly error?: string;
  readonly maxLength?: number;
  readonly editable?: boolean;
};

const elementsOf = (tree: ReactNode) =>
  [tree]
    .flat()
    .filter((node): node is ReactElement<FieldProps> => isValidElement(node));

const fields = (invalid?: ProfileDraftInvalid<CompletionTextField>) =>
  elementsOf(
    elementTree(
      () =>
        ProfileTextFields({
          fields: identityFields,
          draft: profileDraftOf(sampleProfile, "CZ", "CZ"),
          invalid,
          onChange: () => undefined,
          inputs: {
            current: new Map<CompletionTextField, FocusableField | null>(),
          },
          editable: true,
          locale: "en-US",
        }),
      {}
    )
  );

describe("ProfileTextFields", () => {
  test("renders one input per field, in order, each limited like the contract", () => {
    const inputs = fields();
    expect(inputs.map((input) => input.key)).toEqual([...identityFields]);
    expect(inputs.map((input) => input.props.maxLength)).toEqual([
      100, 100, 32,
    ]);
    expect(inputs.every((input) => input.props.error === undefined)).toBe(true);
  });

  test("only the fields with a problem show an error", () => {
    const inputs = fields({
      fields: { phone: "invalid-phone" },
      first: Option.some("phone"),
    });
    expect(
      inputs.map((input) => [input.key, input.props.error !== undefined])
    ).toEqual([
      ["firstName", false],
      ["lastName", false],
      ["phone", true],
    ]);
  });
});
