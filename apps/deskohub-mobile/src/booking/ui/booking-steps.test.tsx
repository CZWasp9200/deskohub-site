import { describe, expect, test } from "bun:test";
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { m } from "../../i18n/messages";
import { Icon } from "../../ui/icon";
import { elementTree, findAll, flatStyle } from "../../ui/testing/element-tree";
import { Text } from "../../ui/text";
import { color } from "../../ui/tokens";
import { type BookingStep, BookingSteps } from "./booking-steps";

type HostElement = ReactElement<{
  readonly style?: unknown;
  readonly children?: ReactNode;
  readonly role?: string;
  readonly "aria-label"?: string;
  readonly accessible?: boolean;
}>;

const steps = (current: BookingStep, raised = false) =>
  elementTree(BookingSteps, {
    current,
    raised,
    locale: "en-US",
  }) as HostElement;

/** Each step's segment colour, check icon and label tone, in order. */
const stepLooks = (current: BookingStep) =>
  Children.toArray(steps(current).props.children)
    .filter(
      (child): child is HostElement =>
        isValidElement(child) &&
        (child.props as { "aria-hidden"?: boolean })["aria-hidden"] === true
    )
    .map((step) => {
      const [segment] = Children.toArray(step.props.children) as HostElement[];
      return {
        segment: flatStyle(segment?.props.style).backgroundColor,
        checked: findAll(step, Icon).length > 0,
        tone: findAll(step, Text)[0]?.props.tone,
      };
    });

const reached = { segment: color.action };
const ahead = { segment: color.disabled, checked: false, tone: "muted" };

describe("BookingSteps", () => {
  test.each<readonly [BookingStep, ReadonlyArray<object>]>([
    ["choose", [{ ...reached, checked: false, tone: "default" }, ahead, ahead]],
    [
      "details",
      [
        { ...reached, checked: true, tone: "muted" },
        { ...reached, checked: false, tone: "default" },
        ahead,
      ],
    ],
    [
      "pay",
      [
        { ...reached, checked: true, tone: "muted" },
        { ...reached, checked: true, tone: "muted" },
        { ...reached, checked: false, tone: "default" },
      ],
    ],
  ])(
    "on %s, fills the steps up to it and checks the ones done",
    (current, looks) => {
      expect(stepLooks(current)).toEqual(
        looks.map((look) => expect.objectContaining(look))
      );
    }
  );

  test.each([
    ["choose", "1", m.booking_steps_choose],
    ["details", "2", m.booking_steps_details],
    ["pay", "3", m.booking_steps_pay],
  ] as const)(
    "reads %s as its step number of three",
    (current, number, name) => {
      const props = steps(current).props;
      expect(props.accessible).toBe(true);
      expect(props["aria-label"]).toBe(
        m.booking_steps_progress(
          { current: number, total: "3", step: name({}, { locale: "en-US" }) },
          { locale: "en-US" }
        )
      );
    }
  );

  test("names every step on screen, on one line each, shrinking rather than truncating at large font sizes", () => {
    const names = findAll<{
      numberOfLines?: number;
      adjustsFontSizeToFit?: boolean;
      children?: ReactNode;
    }>(steps("details"), Text).map((text) => [
      text.props.children,
      text.props.numberOfLines,
      text.props.adjustsFontSizeToFit,
    ]);
    expect(names).toEqual(
      [
        m.booking_steps_choose,
        m.booking_steps_details,
        m.booking_steps_pay,
      ].map((name) => [name({}, { locale: "en-US" }), 1, true])
    );
  });

  test("raised, it draws a hairline and a fade under it", () => {
    const flat = steps("details");
    const raised = steps("details", true);
    expect(flatStyle(flat.props.style).boxShadow).toBeUndefined();
    expect(String(flatStyle(raised.props.style).boxShadow)).toContain(
      color.line
    );
    const fade = (tree: HostElement) =>
      Children.toArray(tree.props.children).filter(
        (child) =>
          isValidElement<{ pointerEvents?: string }>(child) &&
          child.props.pointerEvents === "none"
      );
    expect(fade(flat)).toHaveLength(0);
    expect(fade(raised)).toHaveLength(1);
  });
});
