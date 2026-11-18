import { describe, expect, mock, spyOn, test } from "bun:test";
import {
  act,
  Children,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import * as Native from "react-native";
import { expoRouterStandIn } from "../../testing/expo-router-stand-in";

// The bar registers its height with the toasts while its screen has focus;
// outside a navigator the focus effect does nothing.
mock.module("expo-router", () =>
  expoRouterStandIn({ useFocusEffect: () => undefined })
);

const { clientRoot } = await import("../../testing/client-root");
const { m } = await import("../../i18n/messages");
const { formatMoney } = await import("../../i18n/money-format");
const { Button } = await import("../../ui/controls");
const { idleLiveRegionLayout } = await import("../../ui/notice-presentation");
const { elementTree, find, findAll, flatStyle, hostTree, textOf } =
  await import("../../ui/testing/element-tree");
const { ToastProvider } = await import("../../ui/toast");
const { AvailableWidthContext } = await import("../../ui/viewport");
const { color, touchTarget } = await import("../../ui/tokens");
const { Icon } = await import("../../ui/icon");
const { default: Info } = await import("lucide-react-native/icons/info");
const { default: CircleAlert } = await import(
  "lucide-react-native/icons/circle-alert"
);
const { czk } = await import("../testing/sample-booking-catalog");
const { BookingBar, claimsSwipe, swipeIntent } = await import("./booking-bar");
const { priceBreakdown } = await import("./price-breakdown");
const { describeOfficePriceLine, describePriceLine } = await import(
  "./price-line-description"
);
const { PriceLines } = await import("./price-lines");
const { officeFromPrice } = await import("../family/office-booking-model");
const { officeOnSale, openSpaceWithCoffee } = await import(
  "./testing/price-fixtures"
);

type BarProps = ComponentProps<typeof BookingBar>;
type Price = NonNullable<BarProps["summary"]>["price"];

const locale = "en-US" as const;

// The unit a screen passes for its from-price; the bar shows it as given.
const unit = "unit";

const quoted: Price = {
  kind: "quoted",
  breakdown: priceBreakdown(openSpaceWithCoffee.summary),
  describeLine: describePriceLine(openSpaceWithCoffee.selection, locale),
  was: czk(340),
};

const props = (overrides: Partial<BarProps> = {}): BarProps => ({
  summary: { title: "Thu 26 Nov", detail: "Open Space desk", price: quoted },
  action: { label: "Continue", onPress: () => undefined },
  locale,
  ...overrides,
});

const withToasts = (node: ReactNode) => <ToastProvider>{node}</ToastProvider>;

const bar = (overrides: Partial<BarProps> = {}) =>
  hostTree(elementTree(BookingBar, props(overrides), withToasts));

const wideBar = (overrides: Partial<BarProps>, fontScale = 1) => {
  const dimensions = spyOn(Native, "useWindowDimensions").mockReturnValue({
    width: 840,
    height: 900,
    scale: 2,
    fontScale,
  });
  try {
    return hostTree(
      elementTree(BookingBar, props(overrides), (node) => (
        <AvailableWidthContext value={728}>
          {withToasts(node)}
        </AvailableWidthContext>
      ))
    );
  } finally {
    dimensions.mockRestore();
  }
};

const chevronOf = (tree: ReactNode) =>
  findAll(tree, "Pressable").find(
    (press) => press.props["aria-expanded"] !== undefined
  );

/** The live region under the action. */
const reasonOf = (tree: ReactNode) =>
  findAll(tree, "View")
    .filter((view) => view.props.role === "status")
    .at(-1);

describe("swipes", () => {
  test("a vertical move past a tap's jitter is the bar's, a sideways one is not", () => {
    expect(claimsSwipe({ dx: 0, dy: -4 })).toBe(false);
    expect(claimsSwipe({ dx: 2, dy: -16 })).toBe(true);
    expect(claimsSwipe({ dx: 30, dy: 16 })).toBe(false);
  });

  test("up opens, down closes, a short or sideways swipe does nothing", () => {
    expect(swipeIntent({ dx: 0, dy: -40 })).toBe("open");
    expect(swipeIntent({ dx: 0, dy: 40 })).toBe("close");
    expect(swipeIntent({ dx: 0, dy: -12 })).toBeUndefined();
    expect(swipeIntent({ dx: -60, dy: -40 })).toBeUndefined();
  });
});

describe("BookingBar", () => {
  test("discloses the price beside the action when the available width fits", () => {
    const collapsed = wideBar({});
    const toggle = chevronOf(collapsed);
    expect(toggle?.props["aria-expanded"]).toBe(false);
    expect(flatStyle(toggle?.props.style).minHeight).toBe(touchTarget);
    expect(findAll(toggle, "Text").map(textOf)).toContain(
      m.booking_review_total({}, { locale })
    );
    expect(
      chevronOf(wideBar({ initiallyOpen: true }))?.props["aria-expanded"]
    ).toBe(true);
    expect(flatStyle(chevronOf(wideBar({}, 2))?.props.style).height).toBe(
      touchTarget
    );
  });

  test("keeps the checkout reason at the start when the review has no summary", () => {
    const reason = reasonOf(
      wideBar({ summary: undefined, reason: "Agreement required" })
    );
    expect(flatStyle(reason?.props.style).justifyContent).toBe("flex-start");
    expect(findAll(reason, "Text").map(textOf)).toContain("Agreement required");
  });

  test("shows the quoted total with the earlier price struck above it", () => {
    const texts = findAll(bar(), "Text").map(textOf);
    const total = formatMoney(czk(282), locale);
    const was = formatMoney(czk(340), locale);
    expect(texts).toContain(total);
    expect(texts.indexOf(was)).toBe(texts.indexOf(total) - 1);
    const struck = findAll(bar(), "Text").find((text) => textOf(text) === was);
    expect(flatStyle(struck?.props.style).textDecorationLine).toBe(
      "line-through"
    );
  });

  test("the summary's lines wrap at large text sizes; none is cut", () => {
    const texts = findAll(bar(), "Text").filter(
      (text) => text.props.numberOfLines !== undefined
    );
    expect(texts).toEqual([]);
  });

  test("a quoted price has a collapsed toggle named for showing the details", () => {
    const tree = bar();
    const chevron = chevronOf(tree);
    expect(chevron?.props["aria-expanded"]).toBe(false);
    expect(chevron?.props["aria-label"]).toBe(
      m.booking_price_show_details({}, { locale })
    );
    // No line rows: each reads as one accessible item.
    expect(findAll(tree, "View").some((v) => v.props.accessible)).toBe(false);
  });

  test("opened, it lists the lines above the summary and offers to hide them", () => {
    const tree = elementTree(
      BookingBar,
      props({ initiallyOpen: true }),
      withToasts
    );
    expect(find(tree, PriceLines)?.props.variant).toBe("bar");
    const host = hostTree(tree);
    const chevron = chevronOf(host);
    expect(chevron?.props["aria-expanded"]).toBe(true);
    expect(chevron?.props["aria-label"]).toBe(
      m.booking_price_hide_details({}, { locale })
    );
    expect(flatStyle(find(host, "View")?.props.style).borderTopLeftRadius).toBe(
      20
    );
  });

  test("the opened list scrolls within a share of the window", () => {
    const host = bar({ initiallyOpen: true });
    const list = find(host, "ScrollView");
    expect(findAll(list, "View").some((v) => v.props.accessible)).toBe(true);
    const { maxHeight } = flatStyle(list?.props.style);
    expect(maxHeight).toBeGreaterThan(0);
    expect(maxHeight).toBeLessThan(780);
  });

  test("the price's status region stays mounted, idle until the price updates", () => {
    const statuses = findAll(bar(), "View").filter(
      (view) => view.props.role === "status"
    );
    // The price's region, then the reason's.
    expect(statuses).toHaveLength(2);
    expect(flatStyle(statuses[0]?.props.style)).toMatchObject(
      idleLiveRegionLayout
    );
    expect(findAll(statuses[0], "Text").map(textOf)).toEqual([""]);
  });

  test("the arrow's own target is a full touch target, above what it overlaps", () => {
    const tree = bar();
    const chevron = chevronOf(tree);
    expect(flatStyle(chevron?.props.style).height).toBe(touchTarget);
    expect(chevron?.props.hitSlop).toBeUndefined();
    // The strip is the View right around the arrow.
    const strip = findAll(tree, "View").find((view) =>
      Children.toArray(view.props.children).some(
        (child) =>
          (child as ReactElement<{ "aria-expanded"?: boolean }>).props?.[
            "aria-expanded"
          ] !== undefined
      )
    );
    const own = flatStyle(strip?.props.style);
    expect(own.zIndex).toBeGreaterThan(0);
    // Whatever follows starts where the board's strip ends.
    expect(touchTarget + Number(own.marginBottom)).toBe(20 - 6);
  });

  test("a from-price shows its unit and does not open", () => {
    const tree = bar({
      summary: {
        title: "Open Space desk",
        price: {
          kind: "from",
          amount: czk(232),
          was: czk(290),
          unit,
        },
      },
      initiallyOpen: true,
    });
    expect(chevronOf(tree)).toBeUndefined();
    expect(findAll(tree, "Text").map(textOf)).toContain(unit);
    expect(
      findAll(tree, "Pressable").find((press) => press.props.disabled === true)
    ).toBeDefined();
  });

  test("a from-price given its lines opens to them under its own total", () => {
    const fromPrice: Price = {
      kind: "from",
      amount: czk(282),
      unit,
      itemized: {
        breakdown: priceBreakdown(openSpaceWithCoffee.summary),
        describeLine: describePriceLine(openSpaceWithCoffee.selection, locale),
      },
    };
    const tree = elementTree(
      BookingBar,
      props({
        summary: { title: "Open Space desk", price: fromPrice },
        initiallyOpen: true,
      }),
      withToasts
    );
    expect(find(tree, PriceLines)?.props.variant).toBe("bar");
    const host = hostTree(tree);
    expect(chevronOf(host)?.props["aria-expanded"]).toBe(true);
    expect(findAll(host, "Text").map(textOf)).toContain(unit);
  });

  test("an office from-price during a sale opens to its base lines, then the sale's discount line", () => {
    const breakdown = officeFromPrice(officeOnSale);
    if (breakdown._tag === "None") throw new Error("Expected sale lines");
    const fromPrice: Price = {
      kind: "from",
      amount: officeOnSale.advertisedPrice.price,
      unit,
      itemized: {
        breakdown: breakdown.value,
        describeLine: describeOfficePriceLine(locale, officeOnSale.name),
      },
    };
    const tree = elementTree(
      BookingBar,
      props({
        summary: { title: "Private office", price: fromPrice },
        initiallyOpen: true,
      }),
      withToasts
    );
    const lines = find(tree, PriceLines)?.props.breakdown.lines ?? [];
    expect(lines.map((line) => line._tag)).toEqual([
      "Charge",
      "Charge",
      "Reduction",
    ]);
    expect(findAll(hostTree(tree), "Text").map(textOf)).toContain(
      formatMoney(officeOnSale.advertisedPrice.price, locale)
    );
  });

  test("updating shows the indicator in an announced status, and no total", () => {
    const tree = elementTree(
      BookingBar,
      props({
        summary: { title: "Thu 26 Nov", price: { kind: "updating" } },
      }),
      withToasts
    );
    const host = hostTree(tree);
    const status = findAll(host, "View").find(
      (view) =>
        view.props.role === "status" && view.props["aria-live"] === "polite"
    );
    expect(status).toBeDefined();
    expect(findAll(status, "Text").map(textOf)).toContain(
      m.booking_price_updating({}, { locale })
    );
    expect(chevronOf(host)).toBeUndefined();
    expect(findAll(host, "Text").map(textOf)).not.toContain(
      formatMoney(czk(282), locale)
    );
  });

  test("the reason sits under the action in a polite live region", () => {
    const tree = bar({
      action: { label: "Continue", onPress: () => undefined, disabled: true },
      reason: "why",
    });
    const reason = reasonOf(tree);
    expect(reason?.props["aria-live"]).toBe("polite");
    expect(reason?.props.accessibilityLiveRegion).toBe("polite");
    expect(findAll(reason, "Text").map(textOf)).toEqual(["why"]);
    const parts = Children.toArray(
      (
        elementTree(
          BookingBar,
          props({ reason: "why" }),
          withToasts
        ) as ReactElement<{
          children: ReactNode;
        }>
      ).props.children
    ) as ReadonlyArray<ReactElement>;
    expect(parts.findIndex((part) => part.type === Button)).toBe(
      parts.length - 2
    );
  });

  test("the reason's tone picks its icon and ink", () => {
    // The bar's last part is the reason; render it one level deep, so its
    // icon is still the Icon element.
    const iconsOf = (tone: "info" | "plain" | "error") => {
      const parts = Children.toArray(
        (
          elementTree(
            BookingBar,
            props({ reason: "why", reasonTone: tone }),
            withToasts
          ) as ReactElement<{ children: ReactNode }>
        ).props.children
      ) as ReadonlyArray<ReactElement<Record<string, unknown>>>;
      const reason = parts.at(-1);
      if (reason === undefined || typeof reason.type !== "function") return [];
      const shallow = elementTree(
        reason.type as (props: Record<string, unknown>) => ReactNode,
        reason.props
      );
      return findAll(shallow, Icon).map(
        (icon) => (icon.props as { icon: unknown }).icon
      );
    };
    expect(iconsOf("info")).toEqual([Info]);
    expect(iconsOf("plain")).toEqual([]);
    expect(iconsOf("error")).toEqual([CircleAlert]);
    const errorText = findAll(
      reasonOf(bar({ reason: "why", reasonTone: "error" })),
      "Text"
    )[0];
    expect(flatStyle(errorText?.props.style)).toMatchObject({
      color: color.dangerInk,
    });
  });

  test("without a reason the region stays mounted, out of the layout", () => {
    const reason = reasonOf(bar());
    expect(flatStyle(reason?.props.style)).toMatchObject(idleLiveRegionLayout);
  });

  test("without a summary the bar is the action and its reason alone", () => {
    const tree = elementTree(
      BookingBar,
      props({ summary: undefined, reason: "why" }),
      withToasts
    );
    expect(find(tree, Button)).toBeDefined();
    const host = hostTree(tree);
    expect(chevronOf(host)).toBeUndefined();
    expect(
      findAll(host, "Pressable").filter(
        (press) => press.props.accessible === false
      )
    ).toEqual([]);
    expect(flatStyle(find(host, "View")?.props.style).paddingTop).toBe(12);
  });
});

describe("BookingBar opening and closing", () => {
  const { render } = clientRoot();

  /** Renders the bar as a live component and hands back its latest tree. */
  const live = async (initial: BarProps) => {
    let tree: ReactNode = null;
    const Probe = (barProps: BarProps) => {
      tree = BookingBar(barProps);
      return null;
    };
    const show = (barProps: BarProps) =>
      render(withToasts(<Probe {...barProps} />));
    await show(initial);
    return { tree: () => hostTree(tree), show };
  };

  const isOpen = (tree: ReactNode) =>
    chevronOf(tree)?.props["aria-expanded"] === true;

  const press = (handler: unknown) =>
    act(async () => (handler as () => void)());

  test("the toggle and the summary both open and close it", async () => {
    const bar = await live(props());
    await press(chevronOf(bar.tree())?.props.onPress);
    expect(isOpen(bar.tree())).toBe(true);
    const summary = findAll(bar.tree(), "Pressable").find(
      (pressable) => pressable.props.accessible === false
    );
    await press(summary?.props.onPress);
    expect(isOpen(bar.tree())).toBe(false);
  });

  test("a swipe up opens it and a swipe down closes it", async () => {
    const bar = await live(props());
    const area = () =>
      findAll(bar.tree(), "View").find(
        (view) => view.props.onResponderRelease !== undefined
      )?.props as Record<string, (event: unknown) => unknown>;
    const at = (pageY: number, pageX = 0) => ({
      nativeEvent: { pageX, pageY },
    });
    const swipe = async (from: number, to: number) => {
      const handlers = area();
      expect(handlers.onStartShouldSetResponderCapture?.(at(from))).toBe(false);
      expect(
        handlers.onMoveShouldSetResponderCapture?.(at((from + to) / 2))
      ).toBe(true);
      await act(async () => {
        handlers.onResponderRelease?.(at(to));
      });
    };
    await swipe(300, 240);
    expect(isOpen(bar.tree())).toBe(true);
    await swipe(240, 300);
    expect(isOpen(bar.tree())).toBe(false);
  });

  test("it closes when the price stops being quoted", async () => {
    const bar = await live(props({ initiallyOpen: true }));
    expect(isOpen(bar.tree())).toBe(true);
    await bar.show(
      props({ summary: { title: "Thu 26 Nov", price: { kind: "updating" } } })
    );
    expect(findAll(bar.tree(), "View").some((v) => v.props.accessible)).toBe(
      false
    );
    await bar.show(props());
    expect(isOpen(bar.tree())).toBe(false);
  });
});
