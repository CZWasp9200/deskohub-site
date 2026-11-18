import { describe, expect, test } from "bun:test";
import { Children, isValidElement, type ReactElement } from "react";
import { Badge } from "../../ui/badge";
import {
  elementTree,
  findAll,
  type HostProps,
} from "../../ui/testing/element-tree";
import { Text } from "../../ui/text";
import { BookingTicket } from "./booking-ticket";

const ticket = (badgePlacement?: "header" | "inline") =>
  elementTree(BookingTicket, {
    lead: undefined,
    badge: { label: "badge", tone: "neutral" },
    date: undefined,
    title: "title",
    lines: ["line"],
    ...(badgePlacement && { badgePlacement }),
  });

/** The elements that hold the title line and the badge side by side. */
const titleRowsWithBadge = (tree: ReturnType<typeof ticket>) =>
  findAll(tree, "View").filter((view) => {
    const children = Children.toArray(
      (view as ReactElement<HostProps>).props.children
    ).filter(isValidElement);
    return (
      children.some((child) => child.type === Badge) &&
      children.some(
        (child) =>
          child.type === Text &&
          (child.props as HostProps).variant === "headline"
      )
    );
  });

describe("BookingTicket badge placement", () => {
  test("shows the badge once, in the header row above the title, by default", () => {
    const tree = ticket();
    expect(findAll(tree, Badge)).toHaveLength(1);
    expect(titleRowsWithBadge(tree)).toHaveLength(0);
  });

  test("an inline badge sits beside the title instead, still once", () => {
    const tree = ticket("inline");
    expect(findAll(tree, Badge)).toHaveLength(1);
    expect(titleRowsWithBadge(tree)).toHaveLength(1);
  });
});
