import { useFocusEffect } from "expo-router";
import CircleCheck from "lucide-react-native/icons/circle-check";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "./icon";
import { useLiveRegionAnnouncement } from "./live-announcement";
import { idleLiveRegionLayout } from "./notice-presentation";
import { useReducedMotion } from "./reduced-motion";
import { Text } from "./text";
import {
  noToast,
  type ShownToast,
  type ToastRequest,
  toastAfter,
  toastBottomOffset,
  toastDurationMs,
  toastLook,
} from "./toast-presentation";
import { color, radius, space } from "./tokens";

export type { ToastRequest, ToastTone } from "./toast-presentation";

interface ToastControls {
  readonly show: (request: ToastRequest) => void;
  /** Sets (or with `undefined` clears) the bottom chrome height `key` covers. */
  readonly obstruct: (key: string, height: number | undefined) => void;
}

const ToastContext = createContext<ToastControls | null>(null);

/** The toast rule's distance from the bottom, for every floating overlay. */
const FloatingBottomOffsetContext = createContext<number | null>(null);

const useToastControls = (): ToastControls => {
  const controls = useContext(ToastContext);
  if (!controls) throw new Error("Toasts need a ToastProvider above them.");
  return controls;
};

/**
 * Shows a toast: a green confirmation with a check (the default) or a navy
 * neutral message, with one optional action. A new toast replaces the
 * current one; each dismisses itself after 4 s, or when its action is
 * pressed, and is announced politely.
 */
export const useToast = (): Pick<ToastControls, "show"> => {
  const { show } = useToastControls();
  return useMemo(() => ({ show }), [show]);
};

/**
 * Registers the height a focused layout covers at the bottom of the screen,
 * such as the tab bar or a sticky footer, so toasts sit above it. The
 * registration ends when the layout loses focus or unmounts.
 */
export const useToastObstruction = (height: number) => {
  const key = useId();
  const { obstruct } = useToastControls();
  useFocusEffect(
    useCallback(() => {
      obstruct(key, height);
      return () => obstruct(key, undefined);
    }, [key, height, obstruct])
  );
};

/**
 * How far a floating overlay at the bottom of the screen, such as the toast
 * or the update banner, sits above the bottom: clear of the safe area and of
 * the bottom chrome focused layouts register with `useToastObstruction`.
 */
export const useFloatingBottomOffset = (): number => {
  const offset = useContext(FloatingBottomOffsetContext);
  if (offset === null)
    throw new Error("Floating overlays need a ToastProvider above them.");
  return offset;
};

/** Draws the app's toasts above the screens it wraps; mounted once at the root. */
export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [state, dispatch] = useReducer(toastAfter, noToast);
  const [obstructions, setObstructions] = useState<ReadonlyMap<string, number>>(
    () => new Map()
  );
  const insets = useSafeAreaInsets();
  const controls = useMemo<ToastControls>(
    () => ({
      show: (request) => dispatch({ kind: "show", request }),
      obstruct: (key, height) =>
        setObstructions((current) => {
          const next = new Map(current);
          if (height === undefined) next.delete(key);
          else next.set(key, height);
          return next;
        }),
    }),
    []
  );
  const shownId = state.shown?.id;
  useEffect(() => {
    if (shownId === undefined) return;
    const timer = setTimeout(
      () => dispatch({ kind: "dismiss", id: shownId }),
      toastDurationMs
    );
    return () => clearTimeout(timer);
  }, [shownId]);
  const bottom = toastBottomOffset(insets.bottom, obstructions.values());
  return (
    <ToastContext value={controls}>
      <FloatingBottomOffsetContext value={bottom}>
        <View style={styles.root}>
          {children}
          <Toast
            toast={state.shown}
            bottom={bottom}
            onDismiss={(id) => dispatch({ kind: "dismiss", id })}
          />
        </View>
      </FloatingBottomOffsetContext>
    </ToastContext>
  );
}

/**
 * The toast slot. Its message is a live region that stays mounted while no
 * toast shows, so each new toast is announced; only the box comes and goes.
 */
export function Toast({
  toast,
  bottom,
  onDismiss,
}: {
  readonly toast: ShownToast | undefined;
  readonly bottom: number;
  readonly onDismiss: (id: number) => void;
}) {
  useLiveRegionAnnouncement(toast?.message, "polite");
  const animates = useReducedMotion() === false;
  const appear = useRef(new Animated.Value(1)).current;
  const id = toast?.id;
  useEffect(() => {
    if (id === undefined || !animates) return;
    appear.setValue(0);
    Animated.timing(appear, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [id, animates, appear]);
  const look = toast && toastLook(toast.tone);
  const action = toast?.action;
  return (
    <View style={[styles.slot, { bottom }]}>
      <Animated.View
        style={
          look
            ? [
                styles.toast,
                { backgroundColor: look.backgroundColor, opacity: appear },
                look.lift,
              ]
            : idleLiveRegionLayout
        }
      >
        {look?.checkIcon && (
          <Icon icon={CircleCheck} size={20} color={color.positive} />
        )}
        <Text
          variant="bodySmall"
          tone="inverse"
          role="status"
          aria-live="polite"
          // Text doesn't map `aria-live` to Android's live region; View does.
          accessibilityLiveRegion="polite"
          style={styles.message}
        >
          {toast?.message ?? ""}
        </Text>
        {toast && action && (
          <Pressable
            role="button"
            onPress={() => {
              action.onPress();
              onDismiss(toast.id);
            }}
            // The toast stays 48 tall; the action's target reaches its edges.
            hitSlop={{ top: 14, bottom: 14, left: space.sm, right: space.lg }}
            style={styles.action}
          >
            <Text variant="label" style={styles.actionLabel}>
              {action.label}
            </Text>
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  slot: {
    alignItems: "center",
    left: space.md,
    pointerEvents: "box-none",
    position: "absolute",
    right: space.md,
  },
  toast: {
    alignItems: "center",
    borderRadius: radius.field,
    flexDirection: "row",
    gap: space.md,
    maxWidth: 640,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    width: "100%",
  },
  message: { flexShrink: 1, flexGrow: 1, minWidth: 0 },
  action: { flexShrink: 0, maxWidth: "40%" },
  actionLabel: { color: color.toastAction },
});
