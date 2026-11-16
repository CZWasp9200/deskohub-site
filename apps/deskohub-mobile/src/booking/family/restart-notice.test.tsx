import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { isValidElement } from "react";
import { AppLocaleProvider } from "../../i18n/locale-context";
import { Notice } from "../../ui/notice";
import { elementTree } from "../../ui/testing/element-tree";
import type { CheckoutRestartReason } from "../checkout/booking-problem";
import { restartMessage, restartTitle } from "./booking-family-copy";
import { RestartNotice } from "./restart-notice";

/** The Notice a family screen shows for `reason`, in English. */
const noticeFor = (reason: Option.Option<CheckoutRestartReason>) => {
  const tree = elementTree(RestartNotice, { reason }, (component) => (
    <AppLocaleProvider locale="en-US">{component}</AppLocaleProvider>
  ));
  if (
    !isValidElement<{ tone: string; title?: string; message?: string }>(tree)
  ) {
    throw new Error("RestartNotice rendered no element");
  }
  expect(tree.type).toBe(Notice);
  return tree.props;
};

describe("RestartNotice", () => {
  test("warns with a title that the hold expired after its return", () => {
    const notice = noticeFor(Option.some("hold_expired"));
    expect(notice).toEqual({
      tone: "warning",
      title: restartTitle("hold_expired", "en-US"),
      message: restartMessage("hold_expired", "en-US"),
    });
    expect(notice.title).toEqual(expect.any(String));
  });

  test("warns without a title for any other restart", () => {
    expect(noticeFor(Option.some("availability_changed"))).toEqual({
      tone: "warning",
      title: undefined,
      message: restartMessage("availability_changed", "en-US"),
    });
  });

  test("stays mounted and empty without a reason, so the next one is announced", () => {
    expect(noticeFor(Option.none())).toEqual({
      tone: "warning",
      title: undefined,
      message: undefined,
    });
  });
});
