import {
  type ComponentRef,
  createContext,
  type RefObject,
  useMemo,
  useRef,
} from "react";
import type { LayoutChangeEvent, ScrollView, View } from "react-native";
import { useReducedMotion } from "./reduced-motion";
import { space } from "./tokens";

/** A form field's whole column: its label, frame and hint or error. */
export type FieldView = Pick<
  ComponentRef<typeof View>,
  "measureLayout" | "measureInWindow"
>;

/** What a field tells the scroll view it sits in as it gains and loses focus. */
export interface FocusedFieldTracker {
  readonly focused: (field: FieldView) => void;
  readonly blurred: (field: FieldView) => void;
}

/**
 * The focus tracker of the scroll view a field sits in; outside one, focus
 * moves nothing.
 */
export const FocusedFieldContext = createContext<FocusedFieldTracker>({
  focused: () => undefined,
  blurred: () => undefined,
});

/** The room left between a focused field and what sits under the scroll view. */
const fieldClearance = space.lg;

/**
 * Where to scroll so a field (`top` and `height` in the content, the view
 * scrolled to `offset` and `viewportHeight` tall) shows whole, ending
 * `fieldClearance` above the scroll view's bottom edge; `undefined` when it
 * already shows whole. A field taller than the view shows from the view's
 * top instead, so its label and frame stay in sight.
 */
export const fieldRevealOffset = ({
  top,
  height,
  offset,
  viewportHeight,
}: {
  readonly top: number;
  readonly height: number;
  readonly offset: number;
  readonly viewportHeight: number;
}): number | undefined => {
  const bottom = top + height + fieldClearance;
  if (bottom - top > viewportHeight) return top === offset ? undefined : top;
  if (top >= offset && bottom <= offset + viewportHeight) return undefined;
  return top < offset
    ? Math.max(0, top - fieldClearance)
    : bottom - viewportHeight;
};

/**
 * Keeps the focused field of a scroll view whole above whatever sits under
 * it, such as an `ActionFooter`: when a field takes focus, and when the
 * keyboard shrinks the scroll view while one has it. The scroll view takes
 * `onLayout`, and its content the `tracker` through `FocusedFieldContext`;
 * `TextField` reports its focus there. The scroll jumps under reduced
 * motion.
 */
export const useFocusedFieldScroll = (
  scroll: RefObject<ComponentRef<typeof ScrollView> | null>
): {
  readonly onLayout: (event: LayoutChangeEvent) => void;
  readonly tracker: FocusedFieldTracker;
} => {
  const reducedMotion = useReducedMotion();
  const animated = useRef(true);
  animated.current = reducedMotion !== true;
  const focusedField = useRef<FieldView | null>(null);
  const viewportHeight = useRef<number | undefined>(undefined);

  return useMemo(() => {
    const reveal = (field: FieldView) => {
      const view = scroll.current;
      const viewport = view?.getNativeScrollRef();
      const content = view?.getInnerViewRef();
      if (!view || !viewport || !content) return;
      viewport.measureInWindow((_x, viewportTop, _width, height) =>
        content.measureInWindow((_cx, contentTop) =>
          field.measureLayout(content, (_fx, top, _fieldWidth, fieldHeight) => {
            const y = fieldRevealOffset({
              top,
              height: fieldHeight,
              offset: viewportTop - contentTop,
              viewportHeight: height,
            });
            if (y !== undefined)
              view.scrollTo({ y, animated: animated.current });
          })
        )
      );
    };
    return {
      // Only a shrinking view (the keyboard coming up) moves the field; one
      // growing back leaves the content where it is. The scroll waits a
      // frame: Android's own resize scroll, which only brings the input's
      // frame into view, would otherwise cut an animated one short.
      onLayout: ({ nativeEvent }: LayoutChangeEvent) => {
        const { height } = nativeEvent.layout;
        const shrank =
          viewportHeight.current !== undefined &&
          height < viewportHeight.current;
        viewportHeight.current = height;
        const field = focusedField.current;
        if (shrank && field) requestAnimationFrame(() => reveal(field));
      },
      tracker: {
        focused: (field) => {
          focusedField.current = field;
          reveal(field);
        },
        blurred: (field) => {
          if (focusedField.current === field) focusedField.current = null;
        },
      },
    };
  }, [scroll]);
};
