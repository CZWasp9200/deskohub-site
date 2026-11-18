import { expect, mock, spyOn, test } from "bun:test";
import type {
  NativeStackHeaderProps,
  NativeStackNavigationOptions,
} from "expo-router";
import Users from "lucide-react-native/icons/users";
import { isValidElement, type ReactElement } from "react";
import * as Native from "react-native";
import { expoRouterStandIn } from "../../testing/expo-router-stand-in";

const Screen = (_props: {
  readonly name: string;
  readonly options: NativeStackNavigationOptions;
}) => null;
const Stack = Object.assign(() => null, { Screen });
const setOptions = mock(
  (_options: Pick<NativeStackNavigationOptions, "headerRight">) => undefined
);
const navigation = { getState: () => ({ routes: [] }), setOptions };
mock.module("expo-router", () => ({
  ...expoRouterStandIn({ useNavigation: () => navigation }),
  Stack,
}));
mock.module("expo-router/react-navigation", () => ({
  getHeaderTitle: (options: NativeStackNavigationOptions, fallback: string) =>
    typeof options.headerTitle === "string"
      ? options.headerTitle
      : (options.title ?? fallback),
}));

const { default: BookLayout } = await import(
  "../../../app/(account)/book/_layout"
);
const { AppLocaleProvider } = await import("../../i18n/locale-context");
const { clientRoot } = await import("../../testing/client-root");
const { AppBar } = await import("../../ui/app-bar");
const { StackHeader } = await import("../../ui/navigation");
const { elementTree, find, findAll, flatStyle } = await import(
  "../../ui/testing/element-tree"
);
const { AvailableWidthContext } = await import("../../ui/viewport");
const { ChooseHeaderFact, useChooseHeaderFact } = await import(
  "./choose-header"
);

const withinLandscape = (child: ReactElement) => (
  <AppLocaleProvider locale="en-US">
    <AvailableWidthContext value={1168}>{child}</AvailableWidthContext>
  </AppLocaleProvider>
);

test("Choose routes share the 1040 dp landscape column and put facts in the title bar", () => {
  const dimensions = spyOn(Native, "useWindowDimensions").mockReturnValue({
    width: 1280,
    height: 800,
    scale: 2,
    fontScale: 1,
  });
  try {
    const routes = findAll(
      elementTree(BookLayout, undefined, withinLandscape),
      Screen
    );
    for (const name of ["cowork", "meeting-room", "office"]) {
      const options = routes.find((route) => route.props.name === name)?.props
        .options;
      const fact =
        name === "cowork" ? undefined : (
          <ChooseHeaderFact icon={Users} text="Booking fact" />
        );
      const header = options?.header?.({
        route: { key: name, name },
        options: {
          ...options,
          headerRight: fact === undefined ? undefined : () => fact,
        },
        navigation: {
          goBack: () => undefined,
        } as NativeStackHeaderProps["navigation"],
      });
      if (!isValidElement<Parameters<typeof StackHeader>[0]>(header)) {
        throw new Error(`Missing Choose header for ${name}`);
      }
      const tree = elementTree(StackHeader, header.props, withinLandscape);
      expect(
        findAll(tree, "View").map((view) => flatStyle(view.props.style))
      ).toContainEqual(
        expect.objectContaining({ maxWidth: 1088, paddingHorizontal: 24 })
      );
      expect(find(tree, AppBar)?.props.actions).toBe(fact);
    }
    expect(
      routes.find((route) => route.props.name === "checkout")?.props.options
        .header
    ).toBeUndefined();
  } finally {
    dimensions.mockRestore();
  }
});

const { render } = clientRoot();

function RoomSelection({ capacity }: { readonly capacity: string }) {
  useChooseHeaderFact(Users, capacity);
  return null;
}

function RoomCatalog({
  offering,
}: {
  readonly offering?: { readonly capacity: string };
}) {
  return offering === undefined ? null : (
    <RoomSelection capacity={offering.capacity} />
  );
}

test("a catalog refresh removes its header fact while the Choose route stays open", async () => {
  setOptions.mockClear();
  await render(<RoomCatalog offering={{ capacity: "Up to 10 seats" }} />);
  expect(setOptions.mock.calls.at(-1)?.[0].headerRight).toEqual(
    expect.any(Function)
  );

  await render(<RoomCatalog />);
  expect(setOptions.mock.calls.at(-1)?.[0]).toEqual({ headerRight: undefined });
});
