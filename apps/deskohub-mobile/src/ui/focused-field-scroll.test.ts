import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ComponentRef } from "react";
import type { LayoutChangeEvent, ScrollView } from "react-native";
import {
  type FieldView,
  fieldRevealOffset,
  useFocusedFieldScroll,
} from "./focused-field-scroll";
import { elementTree } from "./testing/element-tree";

describe("fieldRevealOffset", () => {
  // A 600-tall view scrolled to 1000 shows the content from 1000 to 1600.
  const view = { offset: 1000, viewportHeight: 600 };

  test("a field already whole in view stays where it is", () => {
    expect(fieldRevealOffset({ ...view, top: 1100, height: 120 })).toBe(
      undefined
    );
  });

  test("a field reaching under the view's bottom scrolls up to end 16 above it", () => {
    // Bottom at 1620; plus 16 clear is 1636, 36 past the view's 1600.
    expect(fieldRevealOffset({ ...view, top: 1500, height: 120 })).toBe(1036);
  });

  test("a field ending closer than 16 to the bottom scrolls too", () => {
    expect(fieldRevealOffset({ ...view, top: 1470, height: 120 })).toBe(1006);
  });

  test("a field above the view scrolls down to show it 16 below the top", () => {
    expect(fieldRevealOffset({ ...view, top: 900, height: 120 })).toBe(884);
  });

  test("a field taller than the view shows from the view's top", () => {
    expect(fieldRevealOffset({ ...view, top: 1500, height: 590 })).toBe(1500);
    expect(fieldRevealOffset({ ...view, top: 1000, height: 590 })).toBe(
      undefined
    );
  });
});

// Frames run when a test says so.
let frames: Array<() => void> = [];
const nextFrame = () => {
  const due = frames;
  frames = [];
  for (const run of due) run();
};
const realRequestAnimationFrame = globalThis.requestAnimationFrame;
beforeEach(() => {
  frames = [];
  globalThis.requestAnimationFrame = (run) => {
    frames.push(() => run(0));
    return frames.length;
  };
});
afterEach(() => {
  globalThis.requestAnimationFrame = realRequestAnimationFrame;
});

/**
 * A form's scroll view, its viewport at window y 100, recording each scroll
 * request; `layout` resizes it as the keyboard does, and `field(top,
 * height)` places a field in its content.
 */
const scrollingForm = () => {
  const state = { height: 700, offset: 0 };
  const scrolls: Array<{ y: number; animated?: boolean }> = [];
  const content = {
    measureInWindow: (
      done: (x: number, y: number, w: number, h: number) => void
    ) => done(0, 100 - state.offset, 412, 2000),
  };
  const scroll = {
    current: {
      getNativeScrollRef: () => ({
        measureInWindow: (
          done: (x: number, y: number, w: number, h: number) => void
        ) => done(0, 100, 412, state.height),
      }),
      getInnerViewRef: () => content,
      scrollTo: (options: { y: number; animated?: boolean }) => {
        scrolls.push(options);
      },
    } as unknown as ComponentRef<typeof ScrollView>,
  };
  const field = (top: number, fieldHeight: number): FieldView => ({
    measureInWindow: () => undefined,
    measureLayout: (_relativeTo, done) => done(16, top, 380, fieldHeight),
  });
  let form: ReturnType<typeof useFocusedFieldScroll> | undefined;
  elementTree(() => {
    form = useFocusedFieldScroll(scroll);
    return null;
  }, {});
  if (!form) throw new Error("useFocusedFieldScroll returned nothing");
  const layout = (height: number) => {
    state.height = height;
    form?.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: 412, height } },
    } as LayoutChangeEvent);
  };
  return { form, field, layout, scrolls };
};

describe("useFocusedFieldScroll", () => {
  test("the keyboard coming up scrolls the focused field whole above what follows", () => {
    const { form, field, layout, scrolls } = scrollingForm();
    layout(700);
    // The last field, ending at 610: in view until the keyboard is up.
    form.tracker.focused(field(500, 110));
    expect(scrolls).toEqual([]);

    // The keyboard shrinks the view to 400: the field ends at 610, plus 16.
    // The scroll waits a frame, for Android's own resize scroll to finish.
    layout(400);
    expect(scrolls).toEqual([]);
    nextFrame();
    expect(scrolls).toEqual([{ y: 226, animated: true }]);
  });

  test("focus moving to a field under what follows scrolls it into view at once", () => {
    const { form, field, layout, scrolls } = scrollingForm();
    layout(400);
    form.tracker.focused(field(500, 110));
    expect(scrolls).toEqual([{ y: 226, animated: true }]);
  });

  test("the keyboard going down moves nothing", () => {
    const { form, field, layout, scrolls } = scrollingForm();
    layout(400);
    form.tracker.focused(field(100, 110));
    layout(700);
    nextFrame();
    expect(scrolls).toEqual([]);
  });

  test("a field that lost focus no longer moves when the keyboard comes up", () => {
    const { form, field, layout, scrolls } = scrollingForm();
    layout(700);
    const phone = field(500, 110);
    form.tracker.focused(phone);
    form.tracker.blurred(phone);
    layout(400);
    nextFrame();
    expect(scrolls).toEqual([]);
  });

  test("the blur of a field that already passed focus on keeps the new one", () => {
    const { form, field, layout, scrolls } = scrollingForm();
    layout(700);
    const city = field(100, 110);
    const postalCode = field(500, 110);
    form.tracker.focused(city);
    form.tracker.focused(postalCode);
    form.tracker.blurred(city);
    layout(400);
    nextFrame();
    expect(scrolls).toEqual([{ y: 226, animated: true }]);
  });
});
