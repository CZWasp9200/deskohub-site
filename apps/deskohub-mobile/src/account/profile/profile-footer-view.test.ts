import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { CustomerViewError } from "../../customer-api/customer-view-error";
import { identityFields } from "./profile-draft";
import { profileFooterView } from "./profile-footer-view";
import { ProfileSubmitState } from "./profile-save";

const invalid = (
  fields: Parameters<typeof ProfileSubmitState.Invalid>[0]["invalid"]["fields"]
) =>
  ProfileSubmitState.Invalid({
    invalid: { fields, first: Option.none() },
    attempt: {},
  });

describe("profileFooterView", () => {
  test("a clean form rests disabled and says there is nothing to save", () => {
    expect(
      profileFooterView(ProfileSubmitState.Idle(), false, identityFields)
    ).toEqual({
      message: { kind: "no-changes" },
      saveEnabled: false,
      saving: false,
    });
  });

  test("an edited form can save, with nothing to say", () => {
    expect(
      profileFooterView(ProfileSubmitState.Idle(), true, identityFields)
    ).toEqual({ message: undefined, saveEnabled: true, saving: false });
  });

  test("while saving, the button shows progress and can't be pressed again", () => {
    expect(
      profileFooterView(ProfileSubmitState.Submitting(), true, identityFields)
    ).toEqual({ message: undefined, saveEnabled: false, saving: true });
  });

  test("after a save the form rests again", () => {
    expect(
      profileFooterView(
        ProfileSubmitState.Done({ referral: Option.none() }),
        false,
        identityFields
      ).message
    ).toEqual({ kind: "no-changes" });
  });

  test("a refusal counts only the fields this form shows", () => {
    expect(
      profileFooterView(
        invalid({
          firstName: "required",
          phone: "invalid-phone",
          city: "invalid",
        }),
        true,
        identityFields
      ).message
    ).toEqual({ kind: "fix-fields", count: 2 });
  });

  test("a refusal about fields on another screen points there", () => {
    expect(
      profileFooterView(invalid({ city: "invalid" }), true, identityFields)
        .message
    ).toEqual({ kind: "fix-elsewhere" });
  });

  test("a failed request carries its error", () => {
    const error = CustomerViewError.Unexpected();
    expect(
      profileFooterView(
        ProfileSubmitState.Failed({ error }),
        true,
        identityFields
      )
    ).toEqual({
      message: { kind: "failed", error },
      saveEnabled: true,
      saving: false,
    });
  });
});
