import { expect, spyOn, test } from "bun:test";
import { useEffect } from "react";
import * as ReactNative from "react-native";
import { clientRoot } from "../testing/client-root";
import { AuthPhotoSheet } from "./auth-photo-sheet";

const { container, render } = clientRoot();

test("keeps the sign-in action mounted as the window changes size", async () => {
  const sizes = [
    { width: 360, height: 780, fontScale: 1 },
    { width: 840, height: 900, fontScale: 2 },
    { width: 1280, height: 800, fontScale: 2 },
    { width: 360, height: 780, fontScale: 2 },
  ];
  const dimensions = spyOn(ReactNative, "useWindowDimensions");
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
  }
});
