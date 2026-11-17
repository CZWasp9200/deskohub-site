import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
} from "react";
import { Animated, type DimensionValue, Platform, View } from "react-native";
import { ListGroup } from "./list";
import { listRowLayout } from "./list-row-layout";
import { loadingIndicatorSemantics } from "./loading-indicator-presentation";
import { useReducedMotion } from "./reduced-motion";
import { color, radius, space } from "./tokens";

/** One pulse: down to this opacity and back, in `pulseHalf` ms each way. */
const pulseLow = 0.55;
const pulseHalf = 750;

/**
 * An opacity that pulses gently while `enabled`, and holds still otherwise,
 * so a reduced-motion preference keeps skeletons static.
 */
const usePulse = (enabled: boolean) => {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!enabled) {
      opacity.setValue(1);
      return;
    }
    const step = (toValue: number) =>
      Animated.timing(opacity, {
        toValue,
        duration: pulseHalf,
        useNativeDriver: Platform.OS !== "web",
      });
    const pulse = Animated.loop(Animated.sequence([step(pulseLow), step(1)]));
    pulse.start();
    return () => pulse.stop();
  }, [enabled, opacity]);
  return opacity;
};

// A group's blocks share one pulse, so they rise and fall together.
const PulseContext = createContext<Animated.Value | undefined>(undefined);

/**
 * A warm placeholder block in the shape of content that is still loading.
 * It is decorative: the `SkeletonGroup` around it carries the loading label.
 */
export function Skeleton({
  width,
  height,
  radius: cornerRadius = space.sm,
}: {
  readonly width: DimensionValue;
  readonly height: number;
  readonly radius?: number;
}) {
  const shared = useContext(PulseContext);
  const animates = useReducedMotion() === false;
  // A block outside a group pulses on its own.
  const own = usePulse(shared === undefined && animates);
  return (
    <Animated.View
      aria-hidden
      style={{
        backgroundColor: color.skeleton,
        borderRadius: cornerRadius,
        height,
        opacity: shared ?? own,
        width,
      }}
    />
  );
}

/** A list row still loading: an icon tile and one or two lines of text. */
export function SkeletonRow({
  lines = 2,
  icon = true,
}: {
  readonly lines?: 1 | 2;
  readonly icon?: boolean;
}) {
  return (
    <View aria-hidden style={listRowLayout.row}>
      {icon && <Skeleton width={40} height={40} radius={radius.tile} />}
      <View style={[listRowLayout.text, { gap: space.sm }]}>
        <Skeleton width="62%" height={12} radius={6} />
        {lines === 2 && <Skeleton width="40%" height={10} radius={5} />}
      </View>
    </View>
  );
}

/**
 * Placeholder content in the layout it will take, pulsing together, read as
 * one busy progress element named `label`. Give it `rows` for a list group
 * of skeleton rows, or `children` (such as `Skeleton` blocks) for any other
 * shape.
 */
export function SkeletonGroup({
  rows,
  label,
  children,
}: {
  readonly rows?: number;
  readonly label: string;
  readonly children?: ReactNode;
}) {
  const pulse = usePulse(useReducedMotion() === false);
  return (
    <PulseContext.Provider value={pulse}>
      <View {...loadingIndicatorSemantics(label)}>
        {rows !== undefined && (
          <ListGroup>
            {Array.from({ length: rows }, (_, row) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: identical placeholders that never reorder
              <SkeletonRow key={row} icon />
            ))}
          </ListGroup>
        )}
        {children}
      </View>
    </PulseContext.Provider>
  );
}
