import type { CustomerReservationFamily } from "@deskohub/workspace-customer-api";
import { useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { type Href, useNavigationContainerRef, useRouter } from "expo-router";
import { CommonActions } from "expo-router/react-navigation";
import CalendarCheck from "lucide-react-native/icons/calendar-check";
import CircleUser from "lucide-react-native/icons/circle-user";
import DoorClosed from "lucide-react-native/icons/door-closed";
import Laptop from "lucide-react-native/icons/laptop";
import Presentation from "lucide-react-native/icons/presentation";
import type { ComponentProps } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { reservationsAccess, tabGate } from "../account/account-gating";
import { bookFamilyHref, bookHref } from "../booking/booking-routes";
import { checkoutRequestAtom } from "../booking/checkout/checkout-flow";
import { bookingOfferingsAtom } from "../booking/data/booking-queries";
import { opensWithoutAccount } from "../booking/family/booking-family-view";
import { spaceCards } from "../booking/family/space-chooser";
import { accountAtom } from "../customer-api/customer-data-runtime";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import {
  bookingFamilyReset,
  type SignedInDestination,
  signedInDestination,
} from "../routing/signed-in-destination";
import { Icon } from "./icon";
import { Text } from "./text";
import { color, radius, space, touchTarget } from "./tokens";

export const navigationRailWidth = 112;

const productIcons = {
  office: DoorClosed,
  "meeting-room": Presentation,
  cowork: Laptop,
};

function RailLink({
  label,
  icon,
  active,
  onPress,
  product = false,
  dot = false,
}: {
  readonly label: string;
  readonly icon: ComponentProps<typeof Icon>["icon"];
  readonly active: boolean;
  readonly onPress: () => void;
  readonly product?: boolean;
  readonly dot?: boolean;
}) {
  const foreground = product || active ? color.action : color.ink2;
  const canNavigate = product || !active;
  return (
    <Pressable
      role="link"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      aria-current={active ? "page" : undefined}
      onPress={canNavigate ? onPress : undefined}
      style={styles.link}
    >
      {({ pressed }) => (
        <>
          <View
            style={[
              styles.pill,
              (active || pressed) && styles.pillActive,
              product && active && styles.productActive,
            ]}
          >
            <Icon
              icon={icon}
              color={product && active ? color.white : foreground}
            />
            {dot && <View style={styles.dot} />}
          </View>
          <Text
            variant="hintStrong"
            tone={active || product ? "default" : "muted"}
            style={styles.linkLabel}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

function ProductLinks({
  active,
  onOpen,
}: {
  readonly active?: SignedInDestination;
  readonly onOpen: (family: CustomerReservationFamily) => void;
}) {
  const locale = useAppLocale();
  const result = useAtomValue(bookingOfferingsAtom(locale));
  return Option.match(AsyncResult.value(result), {
    onNone: () => null,
    onSome: ({ offerings }) =>
      spaceCards(offerings).map(({ family, name }) => (
        <RailLink
          key={family}
          product
          onPress={() => onOpen(family)}
          active={active === family}
          icon={productIcons[family]}
          label={Option.getOrElse(name, () =>
            m.booking_family_cowork_title({}, { locale })
          )}
        />
      )),
  });
}

export function NavigationRail({
  segments,
  navyStatusBar,
}: {
  readonly segments: readonly string[];
  readonly navyStatusBar: boolean;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  const navigation = useNavigationContainerRef();
  const insets = useSafeAreaInsets();
  const account = useAtomValue(accountAtom);
  const currentAccount = AsyncResult.value(account);
  const profileMissing = Option.exists(
    currentAccount,
    ({ kind }) => kind === "completion-required"
  );
  const canBook =
    opensWithoutAccount(account) ||
    Option.exists(currentAccount, (current) => {
      const access = reservationsAccess(current);
      return (
        access.kind !== "unavailable" && tabGate("book", access) === undefined
      );
    });
  const request = useAtomValue(checkoutRequestAtom);
  const active = signedInDestination(
    segments,
    Option.getOrUndefined(
      Option.map(request, ({ selection }) => selection.family)
    )
  );
  const group = segments[1];
  const open = (href: Href) => {
    if (group === "book" || group === "reservations") {
      router.dismissTo(href);
    } else {
      router.navigate(href);
    }
  };
  const openProduct = (family: CustomerReservationFamily) => {
    if (group === "book") {
      if (segments[2] === family) return;
      const reset = bookingFamilyReset(navigation.getRootState(), family);
      if (reset !== undefined) {
        navigation.dispatch({
          ...CommonActions.reset(reset.state),
          target: reset.target,
        });
        return;
      }
    }
    open(bookFamilyHref(family));
  };
  return (
    <View role="navigation" style={styles.rail}>
      <View
        style={[{ height: insets.top }, navyStatusBar && styles.navyStatusBar]}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.destinations,
          {
            paddingBottom: insets.bottom + space.md,
            paddingLeft: insets.left + space.sm,
          },
        ]}
      >
        <View style={styles.reserve}>
          <Pressable
            role="link"
            onPress={() => open(bookHref)}
            style={styles.reserveLink}
          >
            <Text variant="hintStrong" tone="muted" style={styles.linkLabel}>
              {m.navigation_reserve({}, { locale })}
            </Text>
          </Pressable>
          {canBook && <ProductLinks active={active} onOpen={openProduct} />}
        </View>
        <RailLink
          onPress={() => open("/account")}
          icon={CircleUser}
          active={active === "account"}
          label={m.account_tab_account({}, { locale })}
          dot={profileMissing}
        />
        <RailLink
          onPress={() => open("/reservations")}
          icon={CalendarCheck}
          active={active === "reservations"}
          label={m.account_tab_reservations({}, { locale })}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    width: navigationRailWidth,
    backgroundColor: color.surface,
    borderRightColor: color.line,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  navyStatusBar: { backgroundColor: color.navy },
  destinations: {
    gap: space.sm,
    paddingTop: space.lg,
    paddingRight: space.sm,
  },
  reserve: {
    alignItems: "stretch",
    borderColor: color.line,
    borderStyle: "dashed",
    borderWidth: 1,
    borderRadius: radius.overlay,
    gap: space.sm,
    marginBottom: space.md,
    marginTop: space.sm,
    paddingBottom: space.sm,
    paddingHorizontal: space.xs,
  },
  reserveLink: {
    alignSelf: "center",
    backgroundColor: color.surface,
    justifyContent: "center",
    marginTop: -space.md,
    minHeight: touchTarget,
    paddingHorizontal: space.xs,
  },
  link: {
    alignItems: "center",
    gap: space.xxs,
    justifyContent: "center",
    minHeight: touchTarget,
    paddingVertical: space.xs,
  },
  pill: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 32,
    justifyContent: "center",
    width: 56,
  },
  pillActive: { backgroundColor: color.actionTint },
  productActive: { backgroundColor: color.action },
  dot: {
    backgroundColor: color.action,
    borderColor: color.surface,
    borderRadius: radius.pill,
    borderWidth: 2,
    height: space.sm,
    position: "absolute",
    right: space.md,
    top: space.xxs,
    width: space.sm,
  },
  linkLabel: { maxWidth: "100%", textAlign: "center" },
});
