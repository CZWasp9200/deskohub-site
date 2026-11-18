import { mock } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { Component, createContext, useContext } from "react";
import { postHogStandIn } from "./posthog-stand-in";

// React Native defines `__DEV__` before any module runs, and Expo's modules
// read it on import. Tests run as a release build; one that switches it on
// puts `false` back when it ends, so no file depends on the order it runs in.
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

/**
 * Bun can't load React Native or Expo's native modules, so tests get small
 * stand-ins for the parts the auth code touches: the platform, the app
 * scheme, and crypto backed by Node's.
 */
// React Native's `StyleSheet.flatten`: nested arrays merged left to right,
// falsy entries skipped.
const flattenStyle = (style: unknown): Record<string, unknown> | undefined => {
  if (!style) return undefined;
  if (!Array.isArray(style)) return { ...(style as Record<string, unknown>) };
  return style.reduce<Record<string, unknown>>(
    (merged, entry) => Object.assign(merged, flattenStyle(entry)),
    {}
  );
};

class AnimatedValue {
  constructor(private value: number) {}
  setValue(value: number) {
    this.value = value;
  }
  interpolate(config: { readonly outputRange: readonly unknown[] }) {
    return config.outputRange[0];
  }
  addListener() {
    return "";
  }
  removeAllListeners() {}
  stopAnimation() {}
  valueOf() {
    return this.value;
  }
}

const stillAnimation = () => ({
  start: (done?: (result: { finished: boolean }) => void) =>
    done?.({ finished: true }),
  stop: () => undefined,
  reset: () => undefined,
});

mock.module("react-native", () => ({
  // Host components stand in as their names, so a test can read the element
  // tree a component returns without a native renderer.
  Image: "Image",
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Modal: "Modal",
  Pressable: "Pressable",
  RefreshControl: "RefreshControl",
  ScrollView: "ScrollView",
  Switch: "Switch",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  StyleSheet: {
    absoluteFill: {},
    create: <Styles>(styles: Styles) => styles,
    flatten: flattenStyle,
    hairlineWidth: 1,
  },
  AccessibilityInfo: {
    announceForAccessibility: () => undefined,
    isReduceMotionEnabled: async () => false,
    addEventListener: () => ({ remove: () => undefined }),
  },
  Platform: {
    OS: "android",
    select: (options: Record<string, unknown>) =>
      options.android ?? options.native ?? options.default,
  },
  AppState: {
    currentState: "active",
    addEventListener: () => ({ remove: () => undefined }),
  },
  Linking: {
    addEventListener: () => ({ remove: () => undefined }),
  },
  BackHandler: {
    addEventListener: () => ({ remove: () => undefined }),
  },
  // Animations stand still: values keep what they were set to and every
  // animation finishes at once when started.
  Animated: {
    View: "Animated.View",
    Text: "Animated.Text",
    Value: AnimatedValue,
    timing: stillAnimation,
    spring: stillAnimation,
    loop: stillAnimation,
    sequence: stillAnimation,
    parallel: stillAnimation,
    delay: stillAnimation,
  },
  LayoutAnimation: {
    configureNext: () => undefined,
    Presets: { easeInEaseOut: {} },
  },
  Easing: {
    bezier: () => (t: number) => t,
    ease: (t: number) => t,
    in: (easing: unknown) => easing,
    out: (easing: unknown) => easing,
    inOut: (easing: unknown) => easing,
    linear: (t: number) => t,
    quad: (t: number) => t,
    cubic: (t: number) => t,
  },
  Keyboard: {
    addListener: () => ({ remove: () => undefined }),
    dismiss: () => undefined,
    isVisible: () => false,
    metrics: () => undefined,
  },
  // The design's narrowest phone at the default font size.
  useWindowDimensions: () => ({
    width: 360,
    height: 780,
    scale: 3,
    fontScale: 1,
  }),
}));

// Insets come from the context, as in the library, so a test can provide some.
const SafeAreaInsetsContext = createContext({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});

mock.module("react-native-safe-area-context", () => ({
  SafeAreaInsetsContext,
  SafeAreaView: "SafeAreaView",
  useSafeAreaInsets: () => useContext(SafeAreaInsetsContext),
}));

// SVG elements stand in as their names, so a test can find the icon a
// component draws (Lucide draws through react-native-svg).
const svgElement = (name: string) => name;
mock.module("react-native-svg", () => ({
  default: svgElement("Svg"),
  Svg: svgElement("Svg"),
  Circle: svgElement("Circle"),
  Defs: svgElement("Defs"),
  Ellipse: svgElement("Ellipse"),
  G: svgElement("G"),
  Line: svgElement("Line"),
  LinearGradient: svgElement("LinearGradient"),
  Path: svgElement("Path"),
  Polygon: svgElement("Polygon"),
  Polyline: svgElement("Polyline"),
  Rect: svgElement("Rect"),
  Stop: svgElement("Stop"),
}));

// Lottie's player is a class with commands a component calls through a ref;
// the stand-in keeps them and draws nothing.
class LottieView extends Component<Readonly<Record<string, unknown>>> {
  play() {}
  pause() {}
  resume() {}
  reset() {}
  override render() {
    return null;
  }
}

mock.module("lottie-react-native", () => ({ default: LottieView }));

mock.module("expo-status-bar", () => ({
  StatusBar: () => null,
  setStatusBarStyle: () => undefined,
}));

mock.module("expo-constants", () => ({
  default: { expoConfig: { scheme: "deskohub" } },
}));

mock.module("expo-linking", () => ({
  createURL: (path: string, options?: { readonly scheme?: string }) =>
    `${options?.scheme ?? "deskohub"}://${path.replace(/^\//, "")}`,
}));

mock.module("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  getRandomBytes: (count: number) => new Uint8Array(randomBytes(count)),
  digest: async (_algorithm: string, data: Uint8Array) => {
    const digest = createHash("sha256").update(data).digest();
    return digest.buffer.slice(
      digest.byteOffset,
      digest.byteOffset + digest.byteLength
    );
  },
}));

// The native auth client keeps its session here; a screen that links the
// auth client must load in a test file of its own, not only after another
// file mocked the client.
const secureItems = new Map<string, string>();
mock.module("expo-secure-store", () => ({
  getItem: (key: string) => secureItems.get(key) ?? null,
  setItem: (key: string, value: string) => {
    secureItems.set(key, value);
  },
  getItemAsync: async (key: string) => secureItems.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    secureItems.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    secureItems.delete(key);
  },
}));

// Better Auth's Expo online manager loads this when a session atom mounts.
mock.module("expo-network", () => ({
  addNetworkStateListener: () => ({ remove: () => undefined }),
}));

mock.module("expo-web-browser", () => ({
  openAuthSessionAsync: async () => ({ type: "cancel" }),
  openBrowserAsync: async () => ({ type: "opened" }),
  getCustomTabsSupportingBrowsersAsync: async () => ({
    browserPackages: [],
    servicePackages: [],
  }),
  // Like Expo on Android, where a Custom Tab can't be closed.
  dismissAuthSession: () => {
    throw new Error("WebBrowser.dismissAuthSession is unavailable");
  },
}));

// The app's consent answer loads from here and reads the device language.
// Tests provide their own consent; these keep its module graph loadable.
mock.module("expo-localization", () => ({
  getLocales: () => [{ languageTag: "en-US" }],
  // The device doesn't say its clock: times follow the locale.
  getCalendars: () => [{ uses24hourClock: null }],
}));

const asyncStorageItems = new Map<string, string>();
mock.module("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => asyncStorageItems.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      asyncStorageItems.set(key, value);
    },
    multiRemove: async (keys: readonly string[]) => {
      for (const key of keys) asyncStorageItems.delete(key);
    },
  },
}));

// Analytics clients are built on this stand-in in every test file.
mock.module("posthog-react-native", postHogStandIn);
