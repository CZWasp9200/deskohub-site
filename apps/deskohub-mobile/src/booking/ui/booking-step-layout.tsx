import {
  type ComponentRef,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import type { AppLocale } from "../../i18n/app-locale";
import { ScrollScreenContext } from "../../ui/scroll-screen";
import { color, space } from "../../ui/tokens";
import { QuietUpdateOffer } from "../../updates/update-offer-card";
import { type BookingStep, BookingSteps } from "./booking-steps";

/**
 * A booking step under the stack's app bar: the step progress (raised once
 * the body scrolls), the scrolling body on the screen gutter, and the
 * booking bar pinned at the bottom. Content can scroll the body back to
 * its top as in a `ScrollScreen` (`useScrollScreenToTop`), as a restart
 * notice does.
 */
export function BookingStepLayout({
  step,
  locale,
  bar,
  children,
}: {
  readonly step: BookingStep;
  readonly locale: AppLocale;
  /** The `BookingBar`, always shown, so the price never scrolls away. */
  readonly bar: ReactNode;
  readonly children: ReactNode;
}) {
  const [raised, setRaised] = useState(false);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const scrollToTop = useCallback(
    () => scroll.current?.scrollTo({ y: 0, animated: false }),
    []
  );
  return (
    <View style={styles.screen}>
      <BookingSteps current={step} raised={raised} locale={locale} />
      <ScrollView
        ref={scroll}
        style={styles.body}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={32}
        onScroll={({ nativeEvent }) =>
          setRaised(nativeEvent.contentOffset.y > 0)
        }
      >
        <QuietUpdateOffer backdrop="paper" style={styles.updateOffer} />
        <ScrollScreenContext value={scrollToTop}>
          {children}
        </ScrollScreenContext>
      </ScrollView>
      {bar}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: color.paper, flex: 1 },
  body: { flex: 1 },
  content: {
    gap: 0,
    paddingBottom: space.xxl,
    paddingHorizontal: space.gutter,
    paddingTop: space.md,
  },
  updateOffer: { marginBottom: space.lg },
});
