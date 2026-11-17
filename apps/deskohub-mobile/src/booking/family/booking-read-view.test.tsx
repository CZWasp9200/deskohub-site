import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import type { ReactElement } from "react";
import { CustomerViewError } from "../../customer-api/customer-view-error";
import { AppLocaleProvider } from "../../i18n/locale-context";
import { ErrorState, LoadingState } from "../../ui/async-states";
import { elementTree, find, findAll } from "../../ui/testing/element-tree";
import type { BookingRead } from "./booking-family-view";
import { BookingReadView } from "./booking-read-view";

const placeholder = <Placeholder />;
function Placeholder() {
  return null;
}
function Content() {
  return null;
}

const render = (read: BookingRead<string>) =>
  elementTree(
    BookingReadView<string>,
    {
      read,
      onRetry: () => undefined,
      loading: placeholder,
      failedTitle: "title",
      children: () => <Content />,
    },
    (node: ReactElement) => (
      <AppLocaleProvider locale="en-US">{node}</AppLocaleProvider>
    )
  );

describe("BookingReadView", () => {
  test("shows the screen's placeholder while the first read runs", () => {
    const tree = render({ kind: "loading" });
    expect(find(tree, Placeholder)).toBeDefined();
    expect(find(tree, LoadingState)).toBeUndefined();
    expect(find(tree, Content)).toBeUndefined();
  });

  test("names what didn't load over the cause when the first read fails", () => {
    const tree = render({
      kind: "failed",
      error: CustomerViewError.Unavailable(),
      value: Option.none(),
      retrying: false,
    });
    const error = find(tree, ErrorState)?.props;
    expect(error?.title).toBe("title");
    expect(error?.message).toEqual(expect.any(String));
    expect(findAll(tree, Content)).toHaveLength(0);
  });

  test("shows the content once read", () => {
    const tree = render({ kind: "loaded", value: "x", refreshing: false });
    expect(find(tree, Content)).toBeDefined();
    expect(find(tree, ErrorState)).toBeUndefined();
  });
});
