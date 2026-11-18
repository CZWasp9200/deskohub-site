import { expect, mock, spyOn, test } from "bun:test";
import { useEffect } from "react";
import * as ReactNative from "react-native";
import { clientRoot } from "../testing/client-root";
import { expoRouterStandIn } from "../testing/expo-router-stand-in";
import { elementTree, findAll, flatStyle } from "../ui/testing/element-tree";
import { shadow } from "../ui/tokens";

mock.module("expo-router", () => expoRouterStandIn());

const expoRouter = await import("expo-router");
const { AuthPhotoSheet } = await import("./auth-photo-sheet");

const { container, render } = clientRoot();

test("insets the content of the raised panel by 24 dp inside its column", () => {
  const dimensions = spyOn(ReactNative, "useWindowDimensions").mockReturnValue({
    width: 1280,
    height: 800,
    fontScale: 1,
    scale: 2,
  });
  try {
    const tree = elementTree(AuthPhotoSheet, {
      title: "Sign in",
      body: "Use your email",
      children: null,
    });
    const panel = findAll(tree, ReactNative.View).find(
      ({ props }) => flatStyle(props.style).boxShadow === shadow.sheet.boxShadow
    );
    const [_panel, content] = findAll(panel, ReactNative.View);
    expect(flatStyle(panel?.props.style)).toMatchObject({
      marginLeft: 64,
      paddingHorizontal: 48,
      width: 616,
    });
    expect(flatStyle(content?.props.style)).toMatchObject({
      maxWidth: 520,
      paddingHorizontal: 24,
      gap: 28,
    });
  } finally {
    dimensions.mockRestore();
  }
});

test("keeps the sign-in action mounted as the window changes size", async () => {
  const sizes = [
    { width: 360, height: 780, fontScale: 1 },
    { width: 840, height: 900, fontScale: 2 },
    { width: 1280, height: 800, fontScale: 2 },
    { width: 360, height: 780, fontScale: 2 },
  ];
  const dimensions = spyOn(ReactNative, "useWindowDimensions");
  const routeFocus = spyOn(expoRouter, "useIsFocused").mockReturnValue(false);
  let mounts = 0;
  let unmounts = 0;
  const SignInAction = () => {
    useEffect(() => {
      mounts += 1;
      return () => {
        unmounts += 1;
      };
    }, []);
    return null;
  };

  try {
    for (const size of sizes) {
      dimensions.mockReturnValue({ ...size, scale: 2 });
      await render(
        <AuthPhotoSheet
          title="Sign in"
          body="Use your email"
          compactMasthead={
            <ReactNative.Text>Compact masthead</ReactNative.Text>
          }
        >
          <SignInAction />
        </AuthPhotoSheet>
      );
      expect(container().textContent).toContain(
        size.width < 600 ? "Compact masthead" : "Use your email"
      );
      expect(mounts).toBe(1);
      expect(unmounts).toBe(0);
    }
  } finally {
    await render(null);
    dimensions.mockRestore();
    routeFocus.mockRestore();
  }
});
