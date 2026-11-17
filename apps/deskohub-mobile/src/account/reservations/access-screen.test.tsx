import { describe, expect, mock, test } from "bun:test";
import type { NativeStackHeaderProps } from "expo-router";
import { isValidElement } from "react";
import { reservationsHref } from "../../booking/booking-routes";
import { expoRouterStandIn } from "../../testing/expo-router-stand-in";

mock.module("expo-router", () => expoRouterStandIn());
// Bun can't load expo-router's bundled React Navigation; its title rule is
// the string `headerTitle`, then `title`, then the route's name.
mock.module("expo-router/react-navigation", () => ({
  getHeaderTitle: (
    options: { readonly title?: string; readonly headerTitle?: unknown },
    fallback: string
  ) =>
    typeof options.headerTitle === "string"
      ? options.headerTitle
      : (options.title ?? fallback),
}));
// Contact us only needs the origin, not the native auth client.
mock.module("../../auth/auth-client", () => ({
  apiOrigin: "https://workspace.test",
}));

const { accessStackHeader } = await import("./access-screen");
const { StackHeader } = await import("../../ui/navigation");

describe("accessStackHeader", () => {
  test("in both tones, Back from a PIN with nothing behind it opens the Reservations list", () => {
    for (const tone of ["navy", "paper"] as const) {
      const header = accessStackHeader[tone]({} as NativeStackHeaderProps);
      expect(isValidElement(header) && header.type === StackHeader).toBe(true);
      expect({
        tone,
        backFallback: (header.props as { backFallback?: string }).backFallback,
      }).toEqual({
        tone,
        backFallback: reservationsHref,
      });
    }
  });
});
